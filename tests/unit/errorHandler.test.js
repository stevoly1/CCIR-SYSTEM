const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const request = require('supertest');
const { captureLogs } = require('../helpers/captureLogs');
const { requestLogger } = require('../../middleware/requestLogger');
const errorHandler = require('../../middleware/errorHandler');
const CustomAPIError = require('../../errors/customError');

describe('error handler', () => {
  let logs;
  let server;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(async () => {
    logs.restore();
    if (!server) return;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
    server = null;
  });

  // Bound to loopback explicitly, as tests/helpers/testServer.js explains.
  const serve = async (handler) => {
    const app = express();
    // Express's fallback handler prints to the console only outside the test env.
    app.set('env', 'production');
    app.use(requestLogger);
    app.get('/probe', handler);
    app.use(errorHandler);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };

  it('logs an error raised after the response started, then leaves the connection to Express', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await serve((req, res, next) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial');
      next(new Error('failed mid-stream'));
    });

    await request(url).get('/probe').catch(() => {});

    const line = logs.lines.find((entry) => entry.msg === 'Unhandled error');
    expect(line).toMatchObject({ level: 50, err: { message: 'failed mid-stream' } });
    expect(consoleError).not.toHaveBeenCalled();
  });

  describe('response for every error the handler recognises', () => {
    const log = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });
    const run = (err, req = { id: 'req-test-0001' }) => {
      const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const reqWithLog = { log: log(), ...req };
      errorHandler(err, reqWithLog, res, vi.fn());
      return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0], log: reqWithLog.log };
    };

    it.each([
      ['payload too large', new CustomAPIError('x', 413, 'PAYLOAD_TOO_LARGE'), 413, 'PAYLOAD_TOO_LARGE'],
      ['unsupported media', new CustomAPIError('x', 415, 'UNSUPPORTED_MEDIA_TYPE'), 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['rate limited', new CustomAPIError('x', 429, 'RATE_LIMITED'), 429, 'RATE_LIMITED'],
      ['an application error with details', new CustomAPIError('Bad field', 422, 'SOME_RULE', [{ path: 'body.x' }]), 422, 'SOME_RULE'],
      ['mongoose validation', Object.assign(new Error('v'), { name: 'ValidationError', errors: { title: {} } }), 400, 'VALIDATION_ERROR'],
      ['malformed JSON', Object.assign(new SyntaxError('bad'), { status: 400, body: '{' }), 400, 'VALIDATION_ERROR'],
      ['duplicate key', Object.assign(new Error('dup'), { code: 11000 }), 409, 'CONFLICT'],
      ['cast error', Object.assign(new Error('cast'), { name: 'CastError' }), 400, 'VALIDATION_ERROR'],
      ['multipart file too large', Object.assign(new Error('big'), { code: 'LIMIT_FILE_SIZE' }), 413, 'PAYLOAD_TOO_LARGE'],
      ['body-parser too large', Object.assign(new Error('big'), { type: 'entity.too.large' }), 413, 'PAYLOAD_TOO_LARGE'],
      ['a 413 from elsewhere', Object.assign(new Error('big'), { statusCode: 413 }), 413, 'PAYLOAD_TOO_LARGE'],
    ])('maps %s, logs it briefly, and never returns a request id', (_label, err, status, code) => {
      const result = run(err);
      expect(result.status).toBe(status);
      expect(result.body.error.code).toBe(code);
      expect(result.body.msg).toBe(result.body.error.message);
      expect(result.body.error).not.toHaveProperty('requestId');
      expect(result.log.info).toHaveBeenCalledWith({ requestId: 'req-test-0001', code, status }, 'Request rejected');
      expect(result.log.error).not.toHaveBeenCalled();
    });

    it('keeps the details of an application error and of a validation failure', () => {
      expect(run(new CustomAPIError('Bad field', 422, 'SOME_RULE', [{ path: 'body.x' }])).body.error.details).toEqual([{ path: 'body.x' }]);
      expect(run(Object.assign(new Error('v'), { name: 'ValidationError', errors: { title: {} } })).body.error.details)
        .toEqual([{ path: 'body.title', code: 'INVALID_VALUE', message: 'Invalid value' }]);
      expect(run(Object.assign(new Error('cast'), { name: 'CastError' })).body.error.details)
        .toEqual([{ path: 'params.id', code: 'INVALID_IDENTIFIER', message: 'A valid identifier is required' }]);
    });

    it('logs a known server-side error at warn', () => {
      const result = run(new CustomAPIError('Upstream down', 503, 'SERVICE_UNAVAILABLE'));
      expect(result.status).toBe(503);
      expect(result.log.warn).toHaveBeenCalledWith({ requestId: 'req-test-0001', code: 'SERVICE_UNAVAILABLE', status: 503 }, 'Request rejected');
    });

    it('hides the internals of an unknown error and returns the request id', () => {
      const { status, body, log: calls } = run(new Error('secret internal detail'));
      expect(status).toBe(500);
      expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'req-test-0001' }, msg: 'Something went wrong' });
      expect(JSON.stringify(body)).not.toContain('secret internal detail');
      expect(calls.error).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-test-0001' }), 'Unhandled error');
    });

    it('omits requestId when the request has none, and falls back to the process logger', () => {
      const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      errorHandler(new Error('x'), {}, res, vi.fn());
      expect(res.json.mock.calls[0][0].error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
      expect(logs.lines.find((line) => line.msg === 'Unhandled error')).toBeDefined();
    });
  });
});

describe('error handler: waits the caller is told about', () => {
  const TooManyRequestsError = require('../../errors/tooManyRequestsError');
  let server;
  afterEach(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });

  const serveError = async (error) => {
    const app = express();
    app.get('/probe', (req, res, next) => next(error));
    app.use(errorHandler);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return request(`http://127.0.0.1:${server.address().port}`).get('/probe');
  };

  it.each([
    [61, 'Too many attempts. Please try again in 2 minutes.'],
    [30, 'Too many attempts. Please try again in 1 minute.'],
  ])('names the wait and sets Retry-After when a throttle knows it (%is)', async (seconds, message) => {
    const response = await serveError(new TooManyRequestsError(undefined, { retryAfterSeconds: seconds }));
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe(String(seconds));
    expect(response.body).toEqual({ error: { code: 'RATE_LIMITED', message }, msg: message });
  });

  it('keeps the general message when the wait is unknown', async () => {
    const response = await serveError(new TooManyRequestsError());
    expect(response.body.error.message).toBe('Too many requests, please try again later');
    expect(response.headers['retry-after']).toBeUndefined();
  });
});
