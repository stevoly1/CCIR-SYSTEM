const ai = require('../../services/ai');

// Replaces the AI service for one test. An Error (usually AiError) is thrown instead of returned.
const fakeClassification = (answer = {}) => vi.spyOn(ai, 'classifyReport').mockImplementation(async (input) => {
  const value = typeof answer === 'function' ? await answer(input) : answer;
  if (value instanceof Error) throw value;
  return {
    category: 'Other', priority: 'MEDIUM', summary: 'Fake summary', tags: [], confidence: 0.9,
    ...value,
    meta: { provider: 'kimi', model: 'kimi-test', promptVersion: 'classify-v1', durationMs: 1 },
  };
});

module.exports = { fakeClassification };
