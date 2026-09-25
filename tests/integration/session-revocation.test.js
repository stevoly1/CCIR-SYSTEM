const request = require('supertest');
const jwt = require('jsonwebtoken');
const { sign } = require('cookie-signature');
const { testServer } = require('../helpers/testServer');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { RefreshToken } = require('../../models');

// Each access token names its session (the stored refresh-token record), and every request checks
// that the session is still live, so signing out, suspension, a role change or retirement ends
// access at once instead of up to ACCESS_TOKEN_LIFESPAN later.
const cookieValue = (response, name) => {
  // The last one wins, as in a browser: a renewal first clears the stale cookie, then sets the new one.
  const header = (response.headers['set-cookie'] ?? []).findLast((cookie) => cookie.startsWith(`${name}=`));
  return header && header.split(';')[0].slice(name.length + 1);
};
const onlyRefresh = (raw) => request(testServer()).get('/api/v1/users/profile').set('Cookie', `refreshToken=${raw}`);
const sidOf = (raw) => jwt.decode(decodeURIComponent(raw).slice(2).split('.').slice(0, 3).join('.'))?.sid;
const onlyAccess = (raw) => request(testServer()).get('/api/v1/users/profile').set('Cookie', `accessToken=${raw}`);
const signedAccess = (payload) => encodeURIComponent(`s:${sign(jwt.sign(payload, process.env.JWT_TOKEN, { expiresIn: '15m' }), process.env.COOKIE)}`);

const signIn = async () => {
  const { agent, user, password } = await createAuthenticatedAgent({ role: 'citizen' });
  const login = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email: user.email, password });
  return { agent, user, access: cookieValue(login, 'accessToken'), refresh: cookieValue(login, 'refreshToken') };
};

describe('access tokens end with their session', () => {
  it('names the session in the access token and accepts it while the session lives', async () => {
    const { access } = await signIn();
    const token = decodeURIComponent(access).slice(2).split('.').slice(0, 3).join('.');
    expect(jwt.decode(token)).toMatchObject({ sid: expect.stringMatching(/^[0-9a-f]{24}$/) });
    expect((await onlyAccess(access)).status).toBe(200);
  });

  it('refuses an access token once its user signs out', async () => {
    const { agent, access } = await signIn();
    expect((await onlyAccess(access)).status).toBe(200);
    await unsafeRequest(agent, 'post', '/api/v1/users/logout').send();
    const replay = await onlyAccess(access);
    expect(replay.status).toBe(401);
    // Cleared: a signed empty value that has already expired.
    expect(replay.headers['set-cookie'].find((cookie) => cookie.startsWith('accessToken='))).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('refuses an access token whose session was revoked by an administrator change', async () => {
    const { user, access } = await signIn();
    await RefreshToken.deleteMany({ user: user._id });
    expect((await onlyAccess(access)).status).toBe(401);
  });

  it('treats an access token without a session (issued before this change) as expired, so the refresh path takes over', async () => {
    const { user } = await signIn();
    expect((await onlyAccess(signedAccess({ userId: user.id }))).status).toBe(401);
  });

  it('refuses a session that belongs to someone else', async () => {
    const first = await signIn();
    const second = await signIn();
    const firstToken = jwt.decode(decodeURIComponent(first.access).slice(2).split('.').slice(0, 3).join('.'));
    expect((await onlyAccess(signedAccess({ userId: second.user.id, sid: firstToken.sid }))).status).toBe(401);
  });

  it('issues a session-bound access token when the refresh path renews it', async () => {
    const { refresh } = await signIn();
    const renewed = await onlyRefresh(refresh);
    expect(renewed.status).toBe(200);
    const access = cookieValue(renewed, 'accessToken');
    expect(sidOf(access)).toMatch(/^[0-9a-f]{24}$/);
    expect((await onlyAccess(access)).status).toBe(200);
  });

  it('renews an access token issued before sessions were named, when the refresh cookie is still valid', async () => {
    const { user, refresh } = await signIn();
    const old = signedAccess({ userId: user.id });
    const renewed = await request(testServer()).get('/api/v1/users/profile').set('Cookie', `accessToken=${old}; refreshToken=${refresh}`);
    expect(renewed.status).toBe(200);
    expect(sidOf(cookieValue(renewed, 'accessToken'))).toMatch(/^[0-9a-f]{24}$/);
  });

  it('ends the sessions when signing out with only the access token', async () => {
    const { access, refresh } = await signIn();
    const logout = await unsafeRequest(request(testServer()), 'post', '/api/v1/users/logout').set('Cookie', `accessToken=${access}`).send();
    expect(logout.status).toBe(200);
    expect((await onlyAccess(access)).status).toBe(401);
    expect((await onlyRefresh(refresh)).status).toBe(401);
  });
});
