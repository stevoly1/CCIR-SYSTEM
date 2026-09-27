const { completion, failure } = require('../helpers/fakeKimi.cjs');

const RULES = [
  [/pothole|road/i, 'Roads', 'HIGH'],
  [/drain|flood/i, 'Drainage', 'MEDIUM'],
  [/light/i, 'Streetlights', 'LOW'],
];

const reportText = (request) => {
  const content = request.body.messages.find((message) => message.role === 'user').content;
  const text = typeof content === 'string' ? content : content.find((part) => part.type === 'text').text;
  return text.split('<<<REPORT\n')[1]?.split('\nREPORT>>>')[0] ?? '';
};

const createRules = () => {
  const refused = new Set();
  return (request) => {
    const text = reportText(request);
    if (/refuse-once/.test(text) && !refused.has(text)) {
      refused.add(text);
      return failure(400, 'content_filter');
    }
    const [, category, priority] = RULES.find(([pattern]) => pattern.test(text)) ?? [null, 'Other', 'LOW'];
    const answer = completion(JSON.stringify({ category, priority, summary: `AI summary: ${text.slice(0, 40)}`, tags: [category.toLowerCase()], confidence: 0.9 }));
    return /slowly/.test(text) ? { ...answer, delayMs: 4000 } : answer;
  };
};

module.exports = { createRules };
