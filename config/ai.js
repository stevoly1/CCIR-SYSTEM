// Unset AI_PROVIDER keeps filing available while classification jobs report NOT_CONFIGURED.
// Validation errors name settings, never their values.
const LEGACY = ['GOOGLE_API_KEY', 'GEMINI_MODEL'];

const integer = (env, name, fallback, min, max) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(raw);
};

const fraction = (env, name, fallback) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number from 0 to 1`);
  }
  return value;
};

const parseAiConfig = (env) => {
  const provider = env.AI_PROVIDER || null;
  if (provider !== null && provider !== 'kimi') {
    throw new Error('AI_PROVIDER must be kimi, or unset to run without AI');
  }
  const model = env.KIMI_MODEL || 'kimi-k2.6';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) {
    throw new Error('KIMI_MODEL must be a model name of letters, digits, dots, dashes and underscores');
  }
  const baseUrl = (env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error('KIMI_BASE_URL must be an http or https URL');
  }
  if (baseUrl !== baseUrl.trim() || baseUrl.includes('?') || baseUrl.includes('#') ||
      !['http:', 'https:'].includes(parsedBaseUrl.protocol) || !parsedBaseUrl.hostname ||
      parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new Error('KIMI_BASE_URL must be an http or https URL');
  }
  const apiKey = env.KIMI_API_KEY?.trim() || null;
  return {
    provider,
    configured: provider === 'kimi' && Boolean(apiKey),
    timeoutMs: integer(env, 'AI_TIMEOUT_MS', 20000, 1000, 60000),
    ratePerMinute: integer(env, 'AI_RATE_PER_MINUTE', 20, 1, 600),
    disagreementConfidence: fraction(env, 'AI_DISAGREEMENT_CONFIDENCE', 0.7),
    kimi: { apiKey, model, baseUrl },
  };
};

let cached = null;
const getAiConfig = () => {
  cached ??= parseAiConfig(process.env);
  return cached;
};
const resetAiConfig = () => { cached = null; };
const legacyAiSettings = (env) => LEGACY.filter((name) => env[name] !== undefined && env[name] !== '');

module.exports = { parseAiConfig, getAiConfig, resetAiConfig, legacyAiSettings };
