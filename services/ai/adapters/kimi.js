const { AiError } = require('../aiError');
const { getLogger } = require('../../../utils/logger');

const HOUR_MS = 60 * 60 * 1000;

const retryAfterMs = (response) => {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
};

// The provider's body is read for its error type only. Its message never leaves this function.
const failureFor = async (response, signal) => {
  const type = (await response.json().catch(() => null))?.error?.type;
  if (signal.aborted) return AiError.of('TIMEOUT');
  const { status } = response;
  if (status === 429) {
    if (type === 'exceeded_current_quota_error') {
      getLogger().warn({ event: 'ai_quota_exceeded', provider: 'kimi' }, 'The AI provider account has no balance left');
      return AiError.of('RATE_LIMITED', { retryAfterMs: Math.max(retryAfterMs(response) ?? 0, HOUR_MS) });
    }
    return AiError.of('RATE_LIMITED', { retryAfterMs: retryAfterMs(response) });
  }
  if ([401, 403, 404].includes(status)) return AiError.of('AUTH');
  if (status >= 500) return AiError.of('PROVIDER_DOWN');
  return AiError.of('REFUSED');
};

// One HTTP call, with no retry, fallback, prompt or schema logic.
const createKimiAdapter = ({ apiKey, model, baseUrl, timeoutMs }) => ({
  provider: 'kimi',
  model,
  complete: async ({ system, user, image }) => {
    const content = image
      ? [
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}` } },
        { type: 'text', text: user },
      ]
      : user;
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content }],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
        }),
        signal,
      });
    } catch {
      throw AiError.of(signal.aborted ? 'TIMEOUT' : 'PROVIDER_DOWN');
    }
    if (!response.ok) throw await failureFor(response, signal);
    let data;
    try {
      data = await response.json();
    } catch {
      throw AiError.of(signal.aborted ? 'TIMEOUT' : 'INVALID_OUTPUT');
    }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw AiError.of('REFUSED');
    if (choice?.finish_reason === 'length') throw AiError.of('INVALID_OUTPUT');
    const text = choice?.message?.content;
    if (typeof text !== 'string' || text.length === 0) throw AiError.of('INVALID_OUTPUT');
    return text;
  },
});

module.exports = { createKimiAdapter };
