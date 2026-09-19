const request = require('supertest');
const app = require('../../app');

describe('GET /api/v1/health', () => {
  it('returns the process liveness response without a database', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
