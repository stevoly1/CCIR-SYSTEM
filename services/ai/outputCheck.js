const { z } = require('zod');
const { AiError } = require('./aiError');

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const trimmed = (maximum) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(maximum));

// Only validated category, priority, summary, tags and confidence may reach a report.
const checkClassification = (rawText, categoryNames) => {
  if (typeof rawText !== 'string' || rawText.length === 0) throw AiError.of('INVALID_OUTPUT');
  let candidate;
  try {
    candidate = JSON.parse(rawText);
  } catch {
    throw AiError.of('INVALID_OUTPUT');
  }
  const parsed = z.strictObject({
    category: z.string().refine((value) => categoryNames.includes(value)),
    priority: z.enum(PRIORITIES),
    summary: trimmed(240),
    tags: z.array(trimmed(40)).max(5),
    confidence: z.number().refine(Number.isFinite),
  }).safeParse(candidate);
  if (!parsed.success) throw AiError.of('INVALID_OUTPUT');
  return {
    category: parsed.data.category,
    priority: parsed.data.priority,
    summary: parsed.data.summary,
    tags: [...new Set(parsed.data.tags.map((tag) => tag.toLowerCase()))],
    confidence: Math.min(1, Math.max(0, parsed.data.confidence)),
  };
};

module.exports = { checkClassification, PRIORITIES };
