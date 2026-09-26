const aiService = require('../../services/aiService');
const emailService = require('../../services/emailService');
const { drainOutbox } = require('../helpers/jobs');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');

// `reporter` is allowed: the owner view carries the viewer's own contact-free identity (spec §19).
const FORBIDDEN_KEYS = ['internalNote', 'email', 'phone', 'latitude', 'longitude', 'assignmentHistory', 'editHistory', 'confidence', 'error', 'publicId', 'assignee', 'actor', 'changedBy', 'changedBySnapshot'];
const collectKeys = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, nested]) => { keys.add(key); collectKeys(nested, keys); });
  return keys;
};
const assertOwnerSafe = (body, secrets) => {
  const keys = collectKeys(body);
  FORBIDDEN_KEYS.forEach((key) => expect(keys.has(key), `owner response contains ${key}`).toBe(false));
  secrets.forEach((secret) => expect(JSON.stringify(body), `owner response contains ${secret}`).not.toContain(secret));
};

describe('citizen-visible complaint data', () => {
  it('never exposes staff identity, internal notes, coordinates, or provider detail', async () => {
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue({ category: 'Roads', priority: 'HIGH', summary: 'Pothole', tags: ['road'], confidence: 0.93, error: null });
    const email = vi.spyOn(emailService, 'sendStatusUpdateEmail').mockResolvedValue(undefined);
    await createCategoryFixture({ name: 'Other' });
    await createCategoryFixture({ name: 'Roads' });
    const { agent: citizen } = await createAuthenticatedAgent({ role: 'citizen' });
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin', name: 'Secret Admin Name' });
    const { agent: agency, user: agencyUser } = await createAuthenticatedAgent({ role: 'agency', name: 'Secret Agency Name' });
    const secrets = ['Secret Admin Name', 'Secret Agency Name', 'CONFIDENTIAL-INTERNAL', '6.123', '3.456'];

    const created = await unsafeRequest(citizen, 'post', '/api/v1/complaints').send({
      description: 'Deep pothole by the bridge ramp', address: 'Bridge ramp, Ikeja', latitude: 6.123, longitude: 3.456, coordinateSource: 'DEVICE',
    });
    expect(created.status).toBe(201);
    assertOwnerSafe(created.body, secrets);
    const id = created.body.complaint._id;

    // Every staff write must succeed, or the absence checks below would pass vacuously.
    const assigned = await unsafeRequest(admin, 'patch', `/api/v1/complaints/${id}/assign`).send({ assignedTo: agencyUser.id, reason: 'CONFIDENTIAL-INTERNAL reason' });
    expect(assigned.status).toBe(200);
    const reviewed = await unsafeRequest(agency, 'patch', `/api/v1/complaints/${id}/status`).send({ status: 'IN_REVIEW', publicNote: 'Inspecting soon', internalNote: 'CONFIDENTIAL-INTERNAL note' });
    expect(reviewed.status).toBe(200);
    const reprioritised = await unsafeRequest(agency, 'patch', `/api/v1/complaints/${id}/status`).send({ priority: 'CRITICAL', internalNote: 'CONFIDENTIAL-INTERNAL priority' });
    expect(reprioritised.status).toBe(200);
    const progressed = await unsafeRequest(admin, 'patch', `/api/v1/complaints/${id}/status`).send({ status: 'IN_PROGRESS', publicNote: 'Crew dispatched', internalNote: 'CONFIDENTIAL-INTERNAL admin' });
    expect(progressed.status).toBe(200);

    const detail = await citizen.get(`/api/v1/complaints/${id}`);
    expect(detail.status).toBe(200);
    assertOwnerSafe(detail.body, secrets);
    expect(detail.body.complaint.timeline.map((e) => e.actorLabel)).toEqual(['You', 'Agency staff', 'Agency staff', 'Administrator']);
    expect(detail.body.complaint.timeline.map((e) => e.publicNote)).toEqual(['Report submitted', 'Inspecting soon', undefined, 'Crew dispatched']);
    expect(detail.body.complaint.responsibility).toBe('ASSIGNED');

    const list = await citizen.get('/api/v1/complaints');
    expect(list.status).toBe(200);
    expect(list.body.complaints).toHaveLength(1);
    assertOwnerSafe(list.body, secrets);

    const second = await unsafeRequest(citizen, 'post', '/api/v1/complaints').send({ description: 'Streetlight out at the junction', address: 'Junction, Ikeja' });
    expect(second.status).toBe(201);
    const edited = await unsafeRequest(citizen, 'patch', `/api/v1/complaints/${second.body.complaint._id}`).send({ location: { address: 'Junction by the bank, Ikeja' } });
    expect(edited.status).toBe(200);
    assertOwnerSafe(edited.body, secrets);
    const withdrawn = await unsafeRequest(citizen, 'post', `/api/v1/complaints/${second.body.complaint._id}/withdraw`).send({});
    expect(withdrawn.status).toBe(200);
    assertOwnerSafe(withdrawn.body, secrets);

    // The reporter is emailed on each status change, only ever with the public note.
    await drainOutbox();
    expect(email.mock.calls.map(([args]) => args.publicNote)).toEqual(['Inspecting soon', 'Crew dispatched']);
    email.mock.calls.forEach(([args]) => expect(JSON.stringify(args)).not.toContain('CONFIDENTIAL-INTERNAL'));

    // Positive control: the secrets really are stored, so their absence above is meaningful.
    const staffView = await agency.get(`/api/v1/complaints/${id}`);
    const staffJson = JSON.stringify(staffView.body);
    ['CONFIDENTIAL-INTERNAL note', 'CONFIDENTIAL-INTERNAL reason', 'Secret Agency Name', '6.123', '3.456']
      .forEach((secret) => expect(staffJson, `staff view lacks ${secret}`).toContain(secret));
  });
});
