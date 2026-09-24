const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { getContract } = require('../../utils/openapi');

describe('GET /api/v1/openapi.json', () => {
  it('serves the contract to anyone, without a session', async () => {
    const response = await request(testServer()).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body).toEqual(getContract());
  });
});
