const { getAiConfig } = require('../../config/ai');
const { AiError } = require('./aiError');
const { checkClassification } = require('./outputCheck');
const classifyPrompt = require('./prompts/classify-v1');
const { createKimiAdapter } = require('./adapters/kimi');

// The service picks an adapter, builds the prompt and checks its answer. Retries and fallback
// belong to the background job, so this function makes one provider call at most.
const ADAPTERS = {
  kimi: (config) => createKimiAdapter({ ...config.kimi, timeoutMs: config.timeoutMs }),
};

const adapterFor = (config) => {
  if (!config?.configured || !ADAPTERS[config.provider]) throw AiError.of('NOT_CONFIGURED');
  return ADAPTERS[config.provider](config);
};

const classifyReport = async ({ description, image, categories }, { config = getAiConfig() } = {}) => {
  const adapter = adapterFor(config);
  const started = Date.now();
  const raw = await adapter.complete({ ...classifyPrompt.build({ description, categories, hasImage: Boolean(image) }), image });
  return {
    ...checkClassification(raw, categories),
    meta: { provider: adapter.provider, model: adapter.model, promptVersion: classifyPrompt.version, durationMs: Date.now() - started },
  };
};

module.exports = { classifyReport };
