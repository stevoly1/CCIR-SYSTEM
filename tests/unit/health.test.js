const request = require('supertest');
const { testServer } = require('../helpers/testServer');

describe('GET /api/v1/health', () => {
  it('returns the process liveness response without a database', async () => {
    const response = await request(testServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
