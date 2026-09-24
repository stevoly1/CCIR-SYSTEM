const { Complaint, ComplaintDeletion } = require('../../models');
const uploadService = require('../../services/uploadService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { captureLogs } = require('../helpers/captureLogs');

const remove = (agent, complaint, body) => unsafeRequest(agent, 'delete', `/api/v1/complaints/${complaint.id}`).send(body);

describe('DELETE /api/v1/complaints/:id', () => {
  it('deletes with a reason, logs without complaint content, then cleans images', async () => {
    const { agent, user: admin } = await createAuthenticatedAgent({ role: 'admin', name: 'Deleting Admin' });
    const complaint = await createComplaintFixture({
      status: 'REJECTED',
      description: 'Private description text',
      images: [{ url: 'https://img.test/a.jpg', publicId: 'pid-a' }],
      location: { address: 'Private address' },
    });
    const cleanup = vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue([]);
    const response = await remove(agent, complaint, { reason: '  Spam report  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ msg: 'Complaint deleted' });
    expect(await Complaint.findById(complaint.id)).toBeNull();
    const log = await ComplaintDeletion.findOne({ complaintId: complaint._id }).lean();
    expect(log).toMatchObject({ referenceCode: complaint.referenceCode, statusAtDeletion: 'REJECTED', reason: 'Spam report' });
    expect(log.deletedBy).toMatchObject({ displayName: 'Deleting Admin', role: 'admin' });
    expect(String(log.deletedBy.userId)).toBe(admin.id);
    expect(String(log.reporterId)).toBe(String(complaint.reporter._id ?? complaint.reporter));
    expect(log.deletedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(log)).not.toMatch(/Private description|Private address|pid-a|img\.test/);
    expect(cleanup).toHaveBeenCalledWith(['pid-a']);
  });

  it.each([[{}], [{ reason: '   ' }], [{ reason: 'x'.repeat(501) }]])('requires a valid reason %j', async (body) => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    expect((await remove(agent, complaint, body)).status).toBe(400);
    expect(await Complaint.findById(complaint.id)).not.toBeNull();
    expect(await ComplaintDeletion.countDocuments()).toBe(0);
  });

  it.each(['agency', 'citizen'])('forbids %s, including a reporter of a pending complaint', async (role) => {
    const { agent, user } = await createAuthenticatedAgent({ role });
    const complaint = await createComplaintFixture({ reporter: user });
    const response = await remove(agent, complaint, { reason: 'mine' });
    expect(response.status).toBe(403);
    expect(await Complaint.findById(complaint.id)).not.toBeNull();
  });

  it('writes no log for a stale version', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const response = await remove(agent, complaint, { reason: 'Spam', expectedVersion: complaint.__v + 1 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect(await ComplaintDeletion.countDocuments()).toBe(0);
    expect(await Complaint.findById(complaint.id)).not.toBeNull();
  });

  it('rolls the log back if the delete loses a race inside the transaction', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    vi.spyOn(Complaint, 'deleteOne').mockImplementationOnce(() => ({ session: async () => ({ deletedCount: 0 }) }));
    const response = await remove(agent, complaint, { reason: 'Spam' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect(await ComplaintDeletion.countDocuments()).toBe(0);
    expect(await Complaint.findById(complaint.id)).not.toBeNull();
  });

  it('returns 404 for a missing complaint without logging', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const response = await unsafeRequest(agent, 'delete', '/api/v1/complaints/0123456789abcdef01234567').send({ reason: 'Spam' });
    expect(response.status).toBe(404);
    expect(await ComplaintDeletion.countDocuments()).toBe(0);
  });

  it('succeeds even when image cleanup fails after commit', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture({ images: [{ url: 'https://img.test/a.jpg', publicId: 'pid-a' }] });
    vi.spyOn(uploadService, 'deleteComplaintImages').mockRejectedValue(new Error('cloud down'));
    const logs = captureLogs();
    const response = await remove(agent, complaint, { reason: 'Test data' });
    logs.restore();
    expect(response.status).toBe(200);
    expect(logs.lines.find((line) => line.msg === 'Complaint image cleanup failed after deletion'))
      .toMatchObject({ level: 50, orphanCount: 1, err: { message: 'cloud down' } });
    expect(logs.text()).not.toContain('pid-a');
    expect(await Complaint.findById(complaint.id)).toBeNull();
    expect(await ComplaintDeletion.countDocuments()).toBe(1);
  });

  it('reports deletion permission only to administrators', async () => {
    const complaint = await createComplaintFixture();
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const { agent: agency } = await createAuthenticatedAgent({ role: 'agency' });
    expect((await admin.get(`/api/v1/complaints/${complaint.id}`)).body.complaint.canDelete).toBe(true);
    expect((await agency.get(`/api/v1/complaints/${complaint.id}`)).body.complaint.canDelete).toBe(false);
  });
});
