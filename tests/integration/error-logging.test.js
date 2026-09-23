const request = require('supertest');
const Category = require('../../models/Category');
const { testServer } = require('../helpers/testServer');
const { captureLogs } = require('../helpers/captureLogs');
const { createAuthenticatedAgent } = require('../helpers/auth');

describe('error logging', () => {
  let logs;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  it('logs an unexpected error with its stack and returns the request id', async () => {
    const { agent } = await createAuthenticatedAgent();
    // Thrown synchronously: the citizen path chains .sort().select() onto find().
    vi.spyOn(Category, 'find').mockImplementation(() => {
      throw new Error('database exploded at https://db.test/?token=LEAKME');
    });
    logs.lines.length = 0;

    const response = await agent.get('/api/v1/categories');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: response.headers['x-request-id'] },
      msg: 'Something went wrong',
    });
    const errorLine = logs.lines.find((line) => line.msg === 'Unhandled error');
    expect(errorLine).toMatchObject({ level: 50, requestId: response.headers['x-request-id'], err: { type: 'Error' } });
    expect(errorLine.err.stack).toContain('database exploded');
    expect(logs.text()).not.toContain('LEAKME');
    // The request line links to the error by requestId without a second, synthetic error.
    const requestLine = logs.lines.find((line) => line.req && line.res);
    expect(requestLine).toMatchObject({ level: 50, requestId: response.headers['x-request-id'], res: { statusCode: 500 } });
    expect(requestLine).not.toHaveProperty('err');
    expect(logs.lines.filter((line) => line.err)).toHaveLength(1);
  });

  it('logs a known client error at info level without a stack', async () => {
    const response = await request(testServer()).get('/api/v1/categories');
    expect(response.status).toBe(401);
    const line = logs.lines.find((entry) => entry.msg === 'Request rejected');
    expect(line).toMatchObject({ level: 30, code: response.body.error.code, status: 401, requestId: response.headers['x-request-id'] });
    expect(line).not.toHaveProperty('err');
    expect(response.body.error).not.toHaveProperty('requestId');
  });
});
