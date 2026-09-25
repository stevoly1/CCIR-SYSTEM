const fs = require('fs');
const { z } = require('zod');
const { getLogger } = require('../utils/logger');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const FALLBACK_CATEGORY = 'Other';
// Gemini 3 models think before answering; "low" roughly halved a photo report's time (6-7 s to about
// 3 s) with the same classifications. Earlier models do not take thinkingLevel.
const THINKING_CONFIG = /^gemini-3/.test(GEMINI_MODEL) ? { thinkingLevel: 'low' } : undefined;
// A busy (503) or other passing server error gets one more try. Refusals do not, and neither does a
// quota limit (429): the free tier allows 5 requests a minute, so a retry would only use up more of it.
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 250;

const parseAiTimeout = (value) => {
    if (value === undefined) return 8000;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new Error('AI_TIMEOUT_MS must be an integer between 1000 and 15000');
    }
    const timeout = Number(value);
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 15000) {
        throw new Error('AI_TIMEOUT_MS must be an integer between 1000 and 15000');
    }
    return timeout;
};

const AI_TIMEOUT_MS = parseAiTimeout(process.env.AI_TIMEOUT_MS);

const buildPrompt = (description, categoryNames) => `You are the triage assistant for a civic infrastructure complaint system.
A citizen submitted the following report about a public infrastructure problem (e.g. potholes, broken streetlights, blocked drainage, water leakage, waste accumulation).

Report description: "${description}"

Available categories: ${categoryNames.join(', ')}

Analyze the description (and the attached photo, if provided) and respond with ONLY a JSON object in this exact shape, no markdown fences:
{
  "category": one of the available categories listed above (choose the closest match, or "Other" if none fit),
  "priority": one of "LOW", "MEDIUM", "HIGH", "CRITICAL" (base this on safety risk and urgency),
  "summary": a concise one-sentence summary of the issue,
  "tags": an array of up to 5 short lowercase keyword tags,
  "confidence": a number between 0 and 1 representing your confidence in the category choice
}`;

const normalizedBoundedString = (maximum) => z.string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(maximum));

const validateAiOutput = (rawText, categoryNames) => {
    if (typeof rawText !== 'string' || rawText.length === 0) {
        throw new Error('Invalid AI output');
    }

    let candidate;
    try {
        candidate = JSON.parse(rawText);
    } catch {
        throw new Error('Invalid AI output');
    }

    const schema = z.strictObject({
        category: z.string().refine((value) => categoryNames.includes(value)),
        priority: z.enum(PRIORITIES),
        summary: normalizedBoundedString(240),
        tags: z.array(normalizedBoundedString(40)).max(5),
        confidence: z.number().refine(Number.isFinite),
    });
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) throw new Error('Invalid AI output');

    return {
        category: parsed.data.category,
        priority: parsed.data.priority,
        summary: parsed.data.summary,
        tags: [...new Set(parsed.data.tags.map((tag) => tag.toLowerCase()))],
        confidence: Math.min(1, Math.max(0, parsed.data.confidence)),
        error: null,
    };
};

const fallbackResult = (errorCode) => ({
    category: FALLBACK_CATEGORY,
    priority: 'MEDIUM',
    summary: '',
    tags: [],
    confidence: 0,
    error: errorCode,
});

class AiFailure extends Error {
    // details: non-sensitive facts for the log line, such as the provider's HTTP status.
    constructor(code, details = {}) {
        super(code);
        this.code = code;
        this.details = details;
    }
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Classifies a complaint using Gemini (text + optional image). Every failure is
// reduced to a deterministic non-sensitive fallback so provider outages do not
// block complaint submission.
const classifyComplaint = async ({ description, imageTempFilePath, imageMimeType, categoryNames }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        getLogger().warn({ errorCode: 'PROVIDER_ERROR', reason: 'GOOGLE_API_KEY_MISSING' }, 'AI classification failed; using the fallback');
        return fallbackResult('PROVIDER_ERROR');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
        const parts = [{ text: buildPrompt(description, categoryNames) }];
        if (imageTempFilePath) {
            const imageBuffer = fs.readFileSync(imageTempFilePath);
            parts.push({
                inlineData: {
                    mimeType: imageMimeType || 'image/jpeg',
                    data: imageBuffer.toString('base64'),
                },
            });
        }

        const body = JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: 'application/json', thinkingConfig: THINKING_CONFIG },
        });
        // The key goes in a header, so it never appears in a URL that something might log.
        const request = () => fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body,
                signal: controller.signal,
            },
        );

        // At most two attempts, both inside the one AI_TIMEOUT_MS budget.
        let response;
        for (let attempt = 1; ; attempt += 1) {
            try {
                response = await request();
            } catch (error) {
                if (controller.signal.aborted || error?.name === 'AbortError') throw new AiFailure('TIMEOUT');
                if (attempt === 1) { await pause(RETRY_DELAY_MS); continue; }
                throw new AiFailure('NETWORK_ERROR');
            }
            if (response.ok) break;
            if (attempt === 1 && RETRYABLE_STATUSES.has(response.status)) { await pause(RETRY_DELAY_MS); continue; }
            throw new AiFailure('PROVIDER_ERROR', { providerStatus: response.status });
        }

        let data;
        try {
            data = await response.json();
        } catch (error) {
            if (controller.signal.aborted || error?.name === 'AbortError') throw new AiFailure('TIMEOUT');
            throw new AiFailure('INVALID_OUTPUT');
        }
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        try {
            return validateAiOutput(rawText, categoryNames);
        } catch {
            throw new AiFailure('INVALID_OUTPUT');
        }
    } catch (error) {
        const errorCode = error instanceof AiFailure ? error.code : 'INVALID_OUTPUT';
        getLogger().warn({ errorCode, ...(error instanceof AiFailure ? error.details : {}) }, 'AI classification failed; using the fallback');
        return fallbackResult(errorCode);
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = { classifyComplaint, parseAiTimeout, validateAiOutput };
