const { Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const emailService = require('../../services/emailService');
const locationService = require('../../services/locationService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');

describe('status notes and typed timeline', () => {
  it('stores public and internal notes separately and emails only the public note', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture({ statusHistory: [{ status: 'PENDING', type: 'CREATED' }] });
    const email = vi.spyOn(emailService, 'sendStatusUpdateEmail').mockResolvedValue(undefined);

    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({
      status: 'IN_REVIEW',
      publicNote: 'We are checking the site',
      internalNote: 'Crew B, confidential contractor note',
    });

    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.statusHistory.at(-1)).toMatchObject({
      type: 'STATUS_CHANGED',
      status: 'IN_REVIEW',
      publicNote: 'We are checking the site',
      internalNote: 'Crew B, confidential contractor note',
    });
    expect(email).toHaveBeenCalledTimes(1);
    const [emailArgs] = email.mock.calls[0];
    expect(emailArgs.publicNote).toBe('We are checking the site');
    expect(JSON.stringify(emailArgs)).not.toContain('confidential');
  });

  it('never emails an internal-only note', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const email = vi.spyOn(emailService, 'sendStatusUpdateEmail').mockResolvedValue(undefined);

    await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`)
      .send({ status: 'IN_REVIEW', internalNote: 'confidential only' });

    const [emailArgs] = email.mock.calls[0];
    expect(emailArgs.publicNote).toBeUndefined();
    expect(JSON.stringify(emailArgs)).not.toContain('confidential');
  });

  it('rejects the retired note field', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`)
      .send({ status: 'IN_REVIEW', note: 'old field' });
    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual(expect.objectContaining({ path: 'body.note', code: 'UNKNOWN_FIELD' }));
  });

  it('bounds the internal note length', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`)
      .send({ status: 'IN_REVIEW', internalNote: 'x'.repeat(1001) });
    expect(response.status).toBe(400);
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');
  });

  it('records a CREATED entry when a complaint is filed', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    await createCategoryFixture({ name: 'Other' });
    vi.spyOn(locationService, 'geocodeAddress').mockRejectedValue(new Error('offline in tests'));
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue({
      category: 'Other', priority: 'LOW', summary: 's', tags: [], confidence: 0.9, error: null,
    });
    const response = await unsafeRequest(agent, 'post', '/api/v1/complaints')
      .send({ description: 'A broken streetlight near the market', address: '12 Market Road' });
    expect(response.status).toBe(201);
    const stored = await Complaint.findOne();
    expect(stored.statusHistory[0]).toMatchObject({ type: 'CREATED', status: 'PENDING', publicNote: 'Report submitted' });
  });

  it('stores a withdrawn status value in the schema', async () => {
    const complaint = await createComplaintFixture({ status: 'WITHDRAWN' });
    expect((await Complaint.findById(complaint.id)).status).toBe('WITHDRAWN');
  });
});
