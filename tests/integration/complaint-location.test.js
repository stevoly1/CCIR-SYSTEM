const { Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const locationService = require('../../services/locationService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');

const ai = { category: 'Other', priority: 'LOW', summary: 's', tags: [], confidence: 0.9, error: null };

describe('complaint location rule', () => {
  let agent;
  let user;
  let providerSpies;

  beforeEach(async () => {
    ({ agent, user } = await createAuthenticatedAgent({ role: 'citizen' }));
    await createCategoryFixture({ name: 'Other' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(ai);
    providerSpies = ['autocomplete', 'geocodeAddress', 'reverseGeocode']
      .map((name) => vi.spyOn(locationService, name).mockRejectedValue(new Error('must not be called')));
  });

  const create = (body) => unsafeRequest(agent, 'post', '/api/v1/complaints')
    .send({ description: 'A blocked drain flooding the junction', ...body });

  it('stores a full location exactly and never calls the provider', async () => {
    const response = await create({ address: '12 Market Road', latitude: 6.6, longitude: 3.3, coordinateSource: 'SUGGESTION' });
    expect(response.status).toBe(201);
    const stored = await Complaint.findOne();
    expect(stored.location.toObject()).toEqual({ address: '12 Market Road', latitude: 6.6, longitude: 3.3, coordinateSource: 'SUGGESTION' });
    for (const spy of providerSpies) expect(spy).not.toHaveBeenCalled();
    expect(response.body.complaint).toMatchObject({ address: '12 Market Road', hasPrecisePosition: true });
    expect(response.body.complaint.location).toBeUndefined();
  });

  it('keeps the typed address instead of replacing it with a geocoder guess', async () => {
    const response = await create({ address: 'Behind the old market, Ikeja' });
    expect(response.status).toBe(201);
    const stored = await Complaint.findOne();
    expect(stored.location.toObject()).toEqual({ address: 'Behind the old market, Ikeja' });
    for (const spy of providerSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('accepts multipart string coordinates', async () => {
    const response = await unsafeRequest(agent, 'post', '/api/v1/complaints')
      .field('description', 'A blocked drain flooding the junction')
      .field('address', '12 Market Road')
      .field('latitude', '6.6')
      .field('longitude', '3.3')
      .field('coordinateSource', 'DEVICE');
    expect(response.status).toBe(201);
    expect((await Complaint.findOne()).location.latitude).toBe(6.6);
  });

  it.each([
    [{}, 'body.address'],
    [{ address: '   ' }, 'body.address'],
    [{ address: '12 Market Road', latitude: 6.6, coordinateSource: 'DEVICE' }, 'body.longitude'],
    [{ address: '12 Market Road', latitude: 0, longitude: 0, coordinateSource: 'DEVICE' }, 'body.latitude'],
    [{ address: '12 Market Road', latitude: 6.6, longitude: 3.3 }, 'body.coordinateSource'],
    [{ address: '12 Market Road', coordinateSource: 'DEVICE' }, 'body.coordinateSource'],
  ])('rejects %j', async (body, path) => {
    const response = await create(body);
    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail) => detail.path)).toContain(path);
    expect(await Complaint.countDocuments()).toBe(0);
  });

  it('clears coordinates when only the address is edited', async () => {
    const complaint = await createComplaintFixture({
      reporter: user,
      location: { address: 'Old place', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' },
    });
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}`)
      .send({ location: { address: 'New place, Yaba' } });
    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.location.toObject()).toEqual({ address: 'New place, Yaba' });
    expect(response.body.complaint.hasPrecisePosition).toBe(false);
  });

  it('replaces the location including a new pair', async () => {
    const complaint = await createComplaintFixture({ reporter: user, location: { address: 'Old place' } });
    await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}`)
      .send({ location: { address: 'Market gate', latitude: 6.61, longitude: 3.35, coordinateSource: 'SUGGESTION' } });
    const stored = await Complaint.findById(complaint.id);
    expect(stored.location.toObject()).toEqual({ address: 'Market gate', latitude: 6.61, longitude: 3.35, coordinateSource: 'SUGGESTION' });
    for (const spy of providerSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('leaves the location untouched on a description-only edit', async () => {
    const complaint = await createComplaintFixture({
      reporter: user,
      location: { address: 'Old place', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' },
    });
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}`)
      .send({ description: 'Fixture complaint description, clarified' });
    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.location.toObject()).toEqual({ address: 'Old place', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' });
  });

  it.each([
    [{ address: 'x road' }],
    [{}],
    [{ location: { latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' } }],
  ])('rejects the edit body %j', async (body) => {
    const complaint = await createComplaintFixture({ reporter: user });
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}`).send(body);
    expect(response.status).toBe(400);
  });
});
