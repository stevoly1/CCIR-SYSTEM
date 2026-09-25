const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { User, RefreshToken } = require('../../models');
const { verifyCurrentPassword } = require('../../services/currentPasswordService');
const { endSessions } = require('../../services/sessionService');

describe('current password check', () => {
  it('accepts the right password and refuses a wrong one with WRONG_PASSWORD', async () => {
    const { user, password } = await createAuthenticatedAgent();
    const loaded = await User.findById(user._id).select('+password');
    await expect(verifyCurrentPassword(loaded, password)).resolves.toBeUndefined();
    await expect(verifyCurrentPassword(loaded, 'not-the-password')).rejects.toMatchObject({ statusCode: 401, code: 'WRONG_PASSWORD' });
  });

  it('shares the sign-in lockout: five wrong answers block both the check and sign-in', async () => {
    const { user, password } = await createAuthenticatedAgent();
    const loaded = await User.findById(user._id).select('+password');
    for (let i = 0; i < 5; i += 1) await expect(verifyCurrentPassword(loaded, 'wrong')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    await expect(verifyCurrentPassword(loaded, password)).rejects.toMatchObject({ statusCode: 429 });
    const login = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email: user.email, password });
    expect(login.status).toBe(429);
  });

  it('checks at most five guesses made at the same moment, so a burst cannot find the password', async () => {
    const { user } = await createAuthenticatedAgent();
    const loaded = await User.findById(user._id).select('+password');
    const compare = vi.spyOn(loaded, 'comparePassword');
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => verifyCurrentPassword(loaded, 'wrong')));
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(compare.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('sessions', () => {
  it('ends every session, or every session but one', async () => {
    const { user } = await createAuthenticatedAgent();
    await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email: user.email, password: 'fixture-password' });
    const [keep] = await RefreshToken.find({ user: user._id });
    await endSessions({ userId: user._id, exceptSessionId: keep._id });
    expect((await RefreshToken.find({ user: user._id })).map((t) => String(t._id))).toEqual([String(keep._id)]);
    await endSessions({ userId: user._id });
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(0);
  });

  it('tells a route which session the request belongs to', async () => {
    const { user } = await createAuthenticatedAgent();
    const login = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email: user.email, password: 'fixture-password' });
    const cookies = login.headers['set-cookie'].map((cookie) => cookie.split(';')[0]).join('; ');
    const { authentication } = require('../../middleware/auth');
    const app = require('express')();
    app.use(require('cookie-parser')(process.env.COOKIE));
    let seen;
    app.get('/whoami', authentication, (req, res) => { seen = req.user.sessionId; res.json({}); });
    expect((await request(app).get('/whoami').set('Cookie', cookies)).status).toBe(200);
    expect(await RefreshToken.exists({ _id: seen, user: user._id })).toBeTruthy();
  });
});
