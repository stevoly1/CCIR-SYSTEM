const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createGoogleAgent } = require('../helpers/googleAuth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');
const { Complaint, User, AccountToken } = require('../../models');
const { issueToken } = require('../../services/accountTokenService');
const { retireAccount } = require('../../services/accountRetirementService');

const remove = (agent, body) => unsafeRequest(agent, 'delete', '/api/v1/users/profile').send(body);

describe('delete my account', () => {
  it('needs the password of a password account', async () => {
    const { agent } = await createAuthenticatedAgent();
    expect((await remove(agent, {})).body.error.code).toBe('PASSWORD_REQUIRED');
    const wrong = await remove(agent, { password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    expect((await remove(agent, { password: 'fixture-password', reason: 'Moving away' })).status).toBe(200);
  });

  it('needs a Google account to type its email address', async () => {
    const { agent, profile } = await createGoogleAgent();
    expect((await remove(agent, { confirmEmail: 'someone@else.test' })).body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect((await remove(agent, { confirmEmail: profile.email.toUpperCase() })).status).toBe(200);
  });

  it('erases the name from every snapshot of the person, keeps the reports and cancels links', async () => {
    const { agent, user } = await createAuthenticatedAgent({ name: 'Ngozi Reporter' });
    const snapshot = { userId: user._id, displayName: 'Ngozi Reporter', role: 'citizen' };
    const complaint = await createComplaintFixture({
      reporter: user._id,
      reporterSnapshot: snapshot,
      statusHistory: [{ type: 'WITHDRAWN', status: 'WITHDRAWN', changedBy: user._id, changedBySnapshot: snapshot, createdAt: new Date() }],
      editHistory: [{ editedAt: new Date(), editedBy: snapshot, fields: ['description'], reanalysed: false }],
      assignmentHistory: [{ type: 'WITHDRAWAL_UNASSIGNMENT', previous: null, next: null, changedBy: snapshot, createdAt: new Date() }],
    });
    await issueToken({ userId: user._id, purpose: 'password_reset', requestedBy: user._id });
    expect((await remove(agent, { password: 'fixture-password' })).status).toBe(200);

    const stored = JSON.stringify(await Complaint.findById(complaint._id).lean());
    expect(stored).not.toContain('Ngozi Reporter');
    expect(stored).toContain('Retired account');
    expect(await AccountToken.countDocuments({ user: user._id })).toBe(0);
    expect((await User.findById(user._id)).retiredAt).toBeTruthy();
  });

  it('erases the name from a report the person was once assigned to, and leaves everyone else\'s name', async () => {
    const { agent, user } = await createAuthenticatedAgent({ name: 'Former Handler', role: 'agency' });
    const successor = await createUserFixture({ name: 'Current Handler', role: 'agency' });
    const citizen = await createUserFixture({ name: 'Chioma Citizen' });
    const administrator = await createUserFixture({ name: 'Ada Administrator', role: 'admin' });
    const complaint = await createComplaintFixture({
      reporter: citizen._id,
      reporterSnapshot: { userId: citizen._id, displayName: 'Chioma Citizen', role: 'citizen' },
      assignedTo: successor._id,
      assignmentHistory: [{
        type: 'REASSIGNED',
        previous: { userId: user._id, displayName: 'Former Handler', role: 'agency' },
        next: { userId: successor._id, displayName: 'Current Handler', role: 'agency' },
        changedBy: { userId: administrator._id, displayName: 'Ada Administrator', role: 'admin' },
        createdAt: new Date(),
      }],
    });
    expect((await remove(agent, { password: 'fixture-password' })).status).toBe(200);

    const stored = JSON.stringify(await Complaint.findById(complaint._id).lean());
    expect(stored).not.toContain('Former Handler');
    expect(stored).toContain('Current Handler');
    expect(stored).toContain('Chioma Citizen');
    expect(stored).toContain('Ada Administrator');
  });

  it('keeps the snapshots when an administrator retires the account', async () => {
    const { user: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const citizen = await createUserFixture({ name: 'Kept For Audit' });
    await createComplaintFixture({ reporter: citizen._id, reporterSnapshot: { userId: citizen._id, displayName: 'Kept For Audit', role: 'citizen' } });
    await retireAccount({ targetUserId: citizen._id, actorUserId: admin._id });
    expect(JSON.stringify(await Complaint.find({ reporter: citizen._id }).lean())).toContain('Kept For Audit');
  });
});
