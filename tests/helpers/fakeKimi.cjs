const http = require('node:http');

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Local scripted stand-in for the chat-completions API; no test reaches Moonshot.
const completion = (content, finishReason = 'stop') => ({
  status: 200,
  body: { id: 'fake', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }] },
});
const failure = (status, type, headers = {}) => ({ status, headers, body: { error: { type, message: 'fake provider message' } } });

const startFakeKimi = async (respond = () => failure(500, 'server_error')) => {
  let handler = respond;
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null, receivedAt: Date.now() };
      requests.push(request);
      const answer = await handler(request);
      if (answer.hang) return;
      if (answer.delayMs) await pause(answer.delayMs);
      const text = answer.rawBody ?? JSON.stringify(answer.body ?? {});
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...(answer.headers ?? {}) });
      if (answer.bodyDelayMs) {
        res.write(text.slice(0, 5));
        await pause(answer.bodyDelayMs);
        if (!res.destroyed) res.end(text.slice(5));
        return;
      }
      res.end(text);
    });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    respondWith: (fn) => { handler = fn; },
    stop: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
};

module.exports = { startFakeKimi, completion, failure };
