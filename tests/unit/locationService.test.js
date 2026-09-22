const locationService = require('../../services/locationService');

const feature = (lon, lat, name = 'Market') => ({ geometry: { coordinates: [lon, lat] }, properties: { name, city: 'Ikeja' } });
const okJson = (data) => ({ ok: true, json: async () => data });

describe('location service', () => {
  afterEach(() => vi.useRealTimers());

  it('parses the timeout configuration', () => {
    expect(locationService.parseLocationTimeout(undefined)).toBe(4000);
    expect(locationService.parseLocationTimeout('')).toBe(4000);
    expect(locationService.parseLocationTimeout('2500')).toBe(2500);
    expect(locationService.parseLocationTimeout('10000')).toBe(10000);
    expect(() => locationService.parseLocationTimeout('999')).toThrow(/LOCATION_TIMEOUT_MS/);
    expect(() => locationService.parseLocationTimeout('10001')).toThrow(/LOCATION_TIMEOUT_MS/);
    expect(() => locationService.parseLocationTimeout('2.5')).toThrow(/LOCATION_TIMEOUT_MS/);
    expect(() => locationService.parseLocationTimeout('abc')).toThrow(/LOCATION_TIMEOUT_MS/);
  });

  it('times out as LOCATION_PROVIDER_UNAVAILABLE and passes an abort signal', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = locationService.autocomplete('market');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'LOCATION_PROVIDER_UNAVAILABLE', statusCode: 503 });
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['non-2xx', () => ({ ok: false, status: 502, json: async () => ({}) })],
    ['malformed JSON', () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })],
    ['missing features', () => okJson({ nope: true })],
    ['network error', () => { throw new TypeError('fetch failed'); }],
  ])('maps %s to LOCATION_PROVIDER_UNAVAILABLE for every operation', async (_label, reply) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply());
    await expect(locationService.geocodeAddress('x')).rejects.toMatchObject({ code: 'LOCATION_PROVIDER_UNAVAILABLE' });
    await expect(locationService.autocomplete('x')).rejects.toMatchObject({ code: 'LOCATION_PROVIDER_UNAVAILABLE' });
    await expect(locationService.reverseGeocode(6.6, 3.3)).rejects.toMatchObject({ code: 'LOCATION_PROVIDER_UNAVAILABLE' });
  });

  it('returns empty or null for no match and drops invalid coordinates', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ features: [] }));
    await expect(locationService.autocomplete('x')).resolves.toEqual([]);
    await expect(locationService.geocodeAddress('x')).resolves.toBeNull();
    await expect(locationService.reverseGeocode(6.6, 3.3)).resolves.toBeNull();

    vi.mocked(globalThis.fetch).mockResolvedValue(okJson({ features: [feature('bad', 1), feature(3.35, 6.6), feature(200, 6.6)] }));
    const predictions = await locationService.autocomplete('market');
    expect(predictions).toEqual([{ label: 'Market, Ikeja', address: 'Market, Ikeja', latitude: 6.6, longitude: 3.35 }]);
  });

  it('returns only the formatted label from reverse lookups', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ features: [{ properties: { street: 'Allen Avenue', housenumber: '5', city: 'Ikeja', osm_id: 'secret' } }] }));
    await expect(locationService.reverseGeocode(6.6, 3.3)).resolves.toBe('Allen Avenue 5, Ikeja');
  });
});
