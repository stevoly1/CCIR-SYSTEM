const { createAuthenticatedAgent } = require('../helpers/auth');

describe('location endpoints', () => {
  it('returns 503 LOCATION_PROVIDER_UNAVAILABLE when the provider fails', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const response = await agent.get('/api/v1/location/autocomplete?input=market');
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: 'LOCATION_PROVIDER_UNAVAILABLE', message: expect.any(String) });
    expect(JSON.stringify(response.body)).not.toMatch(/fetch failed|photon/i);
  });

  it('returns 503 for a failed forward geocode', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const response = await agent.get('/api/v1/location/geocode?address=Market%20Road');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('LOCATION_PROVIDER_UNAVAILABLE');
  });

  it('returns a null address for a reverse lookup with no match', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    const response = await agent.get('/api/v1/location/geocode?latitude=6.6&longitude=3.3');
    expect(response.status).toBe(200);
    expect(response.body.location).toEqual({ address: null, latitude: 6.6, longitude: 3.3 });
  });

  it('returns a null location for a forward lookup with no match', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    const response = await agent.get('/api/v1/location/geocode?address=Nowhere%20Street');
    expect(response.status).toBe(200);
    expect(response.body.location).toBeNull();
  });
});
