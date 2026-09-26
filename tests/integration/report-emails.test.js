const { Complaint, OutboxEntry, User } = require('../../models');
const emailService = require('../../services/emailService');
const aiService = require('../../services/aiService');
const referenceService = require('../../services/complaintReferenceService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { drainOutbox } = require('../helpers/jobs');

const file = (agent, description = 'Deep pothole on Market Road near the school') => unsafeRequest(agent, 'post', '/api/v1/complaints')
  .send({ description, address: '12 Market Road, Ikeja' });

describe('report emails', () => {
  beforeEach(async () => {
    await createCategoryFixture({ name: 'Other' });
    await createCategoryFixture({ name: 'Roads' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue({ category: 'Roads', priority: 'HIGH', summary: 's', tags: [], confidence: 0.9, error: null });
    vi.spyOn(emailService, 'sendComplaintFiledEmail').mockResolvedValue(undefined);
    vi.spyOn(emailService, 'sendStatusUpdateEmail').mockResolvedValue(undefined);
  });

  it('queues the filed email with the report, and sends it from the queue', async () => {
    const { agent, user } = await createAuthenticatedAgent();
    const response = await file(agent);
    expect(response.status).toBe(201);
    expect(emailService.sendComplaintFiledEmail).not.toHaveBeenCalled();
    const [entry] = await OutboxEntry.find();
    expect(entry).toMatchObject({ queue: 'email', type: 'report_filed', state: 'PENDING', refs: { complaintId: response.body.complaint._id } });

    await drainOutbox();
    expect(emailService.sendComplaintFiledEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: user.email, referenceCode: response.body.complaint.referenceCode, idempotencyKey: `email-${entry._id}-0`,
    }));
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ state: 'DONE' });
  });

  it('queues nothing when filing fails', async () => {
    const { agent } = await createAuthenticatedAgent();
    vi.spyOn(Complaint, 'create').mockRejectedValueOnce(new Error('write failed'));
    expect((await file(agent)).status).toBe(500);
    expect(await OutboxEntry.countDocuments()).toBe(0);
  });

  it('queues one email when a reference-code collision retries the insert', async () => {
    const { agent } = await createAuthenticatedAgent();
    const first = await file(agent);
    const generate = vi.spyOn(referenceService, 'generate')
      .mockReturnValueOnce(first.body.complaint.referenceCode)
      .mockReturnValueOnce('CCIR-00000777');
    const second = await file(agent, 'Second pothole on Market Road near the bank');
    expect(second.status).toBe(201);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await Complaint.countDocuments()).toBe(2);
    expect((await OutboxEntry.find({ type: 'report_filed' })).map((entry) => entry.refs.complaintId).sort())
      .toEqual([first.body.complaint._id, second.body.complaint._id].sort());
  });

  it('sends the note of the change it belongs to, even after later changes, and only for status changes', async () => {
    const { agent: citizen } = await createAuthenticatedAgent();
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const filed = await file(citizen);
    const id = filed.body.complaint._id;
    const change = (body) => unsafeRequest(admin, 'patch', `/api/v1/complaints/${id}/status`).send(body);
    expect((await change({ status: 'IN_REVIEW', publicNote: 'We are looking at it' })).status).toBe(200);
    expect((await change({ status: 'IN_PROGRESS', publicNote: 'Crew assigned' })).status).toBe(200);
    expect((await change({ priority: 'CRITICAL' })).status).toBe(200);
    expect(await OutboxEntry.countDocuments({ type: 'status_update' })).toBe(2);

    await drainOutbox();
    const notes = emailService.sendStatusUpdateEmail.mock.calls.map(([message]) => [message.status, message.publicNote]);
    expect(notes).toEqual([['IN_REVIEW', 'We are looking at it'], ['IN_PROGRESS', 'Crew assigned']]);
  });

  it('queues nothing when a status change loses a race', async () => {
    const { agent: citizen } = await createAuthenticatedAgent();
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const filed = await file(citizen);
    const id = filed.body.complaint._id;
    // The request reads the report, then another change lands before its write.
    const before = await Complaint.findById(id);
    await Complaint.updateOne({ _id: id }, { $set: { status: 'IN_REVIEW' }, $inc: { __v: 1 } });
    vi.spyOn(Complaint, 'findById').mockResolvedValueOnce(before);
    const lost = await unsafeRequest(admin, 'patch', `/api/v1/complaints/${id}/status`).send({ status: 'REJECTED', publicNote: 'Duplicate report' });
    expect(lost.status).toBe(409);
    expect(lost.body.error.code).toBe('STALE_COMPLAINT');
    expect(await OutboxEntry.countDocuments({ type: 'status_update' })).toBe(0);
  });

  it('sends nothing to a retired reporter, and nothing twice when a job runs again', async () => {
    const { agent, user } = await createAuthenticatedAgent();
    await file(agent);
    const [entry] = await OutboxEntry.find();
    await drainOutbox();
    await OutboxEntry.updateOne({ _id: entry._id }, { state: 'PENDING' });
    await drainOutbox();
    expect(emailService.sendComplaintFiledEmail).toHaveBeenCalledTimes(1);

    await file(agent, 'Second pothole on Market Road near the bank');
    await User.updateOne({ _id: user._id }, { retiredAt: new Date(), isActive: false });
    await drainOutbox();
    expect(emailService.sendComplaintFiledEmail).toHaveBeenCalledTimes(1);
    expect(await OutboxEntry.countDocuments({ state: 'DONE' })).toBe(2);
  });
});
