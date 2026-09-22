const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const app = require('../../app');

async function* multipartBody(boundary, fields, files) {
  for (const [name, value] of Object.entries(fields)) {
    yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const file of files) {
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${path.basename(file.path)}"\r\n`
      + `Content-Type: ${file.contentType}\r\n\r\n`,
    );
    for await (const chunk of fs.createReadStream(file.path)) yield chunk;
    yield Buffer.from('\r\n');
  }
  yield Buffer.from(`--${boundary}--\r\n`);
}

// Sends a multipart request and resolves with the server's response even when the
// server answers early and closes before the client finishes sending (EPIPE/ECONNRESET).
const postMultipartAllowingEarlyResponse = async ({ credentials, path: requestPath, fields = {}, files = [] }) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const origin = process.env.BROWSER_ORIGIN;
  try {
    const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(credentials),
    });
    if (login.status !== 200) throw new Error(`Helper login failed with status ${login.status}`);
    const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const boundary = `----ccir${randomBytes(12).toString('hex')}`;

    return await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };
      const request = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: requestPath,
        headers: { origin, cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      request.on('response', (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          settle(resolve, { status: response.statusCode, body });
        });
        response.on('error', (error) => settle(reject, error));
      });
      request.on('error', (error) => {
        if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') settle(reject, error);
      });
      request.on('close', () => settle(reject, new Error('Connection closed before any response was received')));
      (async () => {
        try {
          for await (const chunk of multipartBody(boundary, fields, files)) {
            if (request.destroyed) return;
            if (!request.write(chunk)) await once(request, 'drain');
          }
          request.end();
        } catch {
          // Writes after an early server close fail; the response handlers decide the outcome.
        }
      })();
    });
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
};

module.exports = { postMultipartAllowingEarlyResponse };
