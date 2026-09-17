const fs = require('fs');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

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

// Classifies a complaint using Gemini (text + optional image). Never throws — on any
// failure it returns a fallback result so complaint submission is never blocked by an AI outage.
const classifyComplaint = async ({ description, imageTempFilePath, imageMimeType, categoryNames }) => {
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
        return fallbackResult('AI classification is not configured (missing GOOGLE_API_KEY)');
    }

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

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseMimeType: 'application/json' },
                }),
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
            throw new Error('Gemini returned an empty response');
        }

        const parsed = JSON.parse(rawText);

        return {
            category: parsed.category || 'Other',
            priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(parsed.priority) ? parsed.priority : 'MEDIUM',
            summary: parsed.summary || '',
            tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
            error: null,
        };
    } catch (error) {
        console.error('AI classification failed:', error.message);
        return fallbackResult(error.message);
    }
};

const fallbackResult = (errorMessage) => ({
    category: 'Other',
    priority: 'MEDIUM',
    summary: '',
    tags: [],
    confidence: 0,
    error: errorMessage,
});

module.exports = { classifyComplaint };
