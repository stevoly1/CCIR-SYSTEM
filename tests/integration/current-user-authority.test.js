const jwt = require('jsonwebtoken');
const signature = require('cookie-signature');
const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { RefreshToken, User } = require('../../models');
const { retireAccount } = require('../../services/accountRetirementService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');

const cookieValue = (response, name) => {
  const header = response.headers['set-cookie']?.find((value) => value.startsWith(`${name}=`));
  if (!header) throw new Error(`Missing ${name} cookie`);
  return header.split(';', 1)[0];
};

const loginWithoutAgent = async (user, password = 'fixture-password') => unsafeRequest(
  request(testServer()),
  'post',
  '/api/v1/auth/login',
).send({ email: user.email, password });

describe('current persisted user authority', () => {
  it('uses the current persisted role instead of stale access-token authority', async () => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'admin' });
    await User.updateOne({ _id: user._id }, { $set: { role: 'citizen' } });

    const response = await agent.get('/api/v1/users');

    expect(response.status).toBe(403);
  });

  it.each([
    ['deactivated', async (user) => User.updateOne({ _id: user._id }, { $set: { isActive: false } })],
    ['retired', async (user) => {
      const actor = await createUserFixture({ role: 'admin' });
      return retireAccount({ targetUserId: user.id, actorUserId: actor.id, reason: 'Authority test' });
    }],
  ])('rejects a still-valid access token after the user is %s', async (_label, mutateUser) => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'admin' });
    await mutateUser(user);

    const response = await agent.get('/api/v1/users');

    expect(response.status).toBe(401);
  });

  describe('access tokens that must not authenticate', () => {
    // Exactly what the browser would send: a signed cookie holding a JWT, and no refresh token.
    const accessCookie = (token, cookieSecret = process.env.COOKIE) => `accessToken=${encodeURIComponent(`s:${signature.sign(token, cookieSecret)}`)}`;
    const profileWith = (cookie) => request(testServer()).get('/api/v1/users/profile').set('Cookie', cookie);

    it('accepts a correctly signed, current token for a live session (control for the cases below)', async () => {
      const user = await createUserFixture();
      const session = await RefreshToken.create({ token: `control-${user.id}`, user: user._id, expiresAt: new Date(Date.now() + 60000) });
      const token = jwt.sign({ userId: user.id, sid: session.id }, process.env.JWT_TOKEN, { expiresIn: '15m' });
      expect((await profileWith(accessCookie(token))).status).toBe(200);
    });

    it.each([
      ['an expired token', (user) => accessCookie(jwt.sign({ userId: user.id, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_TOKEN))],
      ['a token signed with another key', (user) => accessCookie(jwt.sign({ userId: user.id }, 'not-the-server-key', { expiresIn: '15m' }))],
      ['a cookie whose signature was tampered with', (user) => accessCookie(jwt.sign({ userId: user.id }, process.env.JWT_TOKEN, { expiresIn: '15m' }), 'not-the-cookie-secret')],
      ['an unsigned cookie', (user) => `accessToken=${jwt.sign({ userId: user.id }, process.env.JWT_TOKEN, { expiresIn: '15m' })}`],
      ['a refresh token signed with another key, and no access token', (user) => `refreshToken=${encodeURIComponent(`s:${signature.sign(jwt.sign({ userId: user.id }, 'not-the-refresh-key', { expiresIn: '7d' }), process.env.COOKIE)}`)}`],
    ])('rejects %s with 401', async (_label, cookieFor) => {
      const user = await createUserFixture();
      const response = await profileWith(cookieFor(user));
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  it('puts only user identity, the session and JWT timing claims in an access token', async () => {
    const user = await createUserFixture({ role: 'admin' });
    const response = await loginWithoutAgent(user);
    const encodedCookie = cookieValue(response, 'accessToken').split('=', 2)[1];
    const signedCookie = decodeURIComponent(encodedCookie);
    const token = signature.unsign(signedCookie.slice(2), process.env.COOKIE);

    expect(token).toBeTruthy();
    expect(Object.keys(jwt.decode(token)).sort()).toEqual(['exp', 'iat', 'sid', 'userId']);
    expect(jwt.decode(token)).toEqual(expect.objectContaining({ userId: user.id }));
    expect(jwt.decode(token)).not.toHaveProperty('email');
    expect(jwt.decode(token)).not.toHaveProperty('role');
  });

  it('does not disguise a current-user database failure as an authentication denial', async () => {
    const { agent } = await createAuthenticatedAgent();
    const findUser = vi.spyOn(User, 'findById').mockRejectedValueOnce(new Error('database unavailable'));

    const response = await agent.get('/api/v1/users/profile');

    expect(response.status).toBe(500);
    findUser.mockRestore();
  });

  it('uses the same public login failure for inactive and invalid accounts', async () => {
    const inactive = await createUserFixture({ isActive: false });
    const inactiveResponse = await loginWithoutAgent(inactive);
    const invalidResponse = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({
      email: 'missing-user@example.test',
      password: 'fixture-password',
    });

    expect(inactiveResponse.status).toBe(401);
    expect(inactiveResponse.body).toEqual(invalidResponse.body);
  });

  it('rejects a refresh token whose stored owner differs from its JWT owner', async () => {
    const owner = await createUserFixture();
    const otherUser = await createUserFixture();
    const login = await loginWithoutAgent(owner);
    const refreshCookie = cookieValue(login, 'refreshToken');
    await RefreshToken.updateOne({}, { $set: { user: otherUser._id } });

    const response = await request(testServer())
      .get('/api/v1/users/profile')
      .set('Cookie', refreshCookie);

    expect(response.status).toBe(401);
  });

  it('accepts a valid owner-bound refresh for an active current user', async () => {
    const owner = await createUserFixture();
    const login = await loginWithoutAgent(owner);
    const refreshCookie = cookieValue(login, 'refreshToken');

    const response = await request(testServer())
      .get('/api/v1/users/profile')
      .set('Cookie', refreshCookie);

    expect(response.status).toBe(200);
    expect(response.body.user._id).toBe(owner.id);
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  it.each([
    ['revoked', async () => RefreshToken.deleteMany({})],
    ['expired', async () => RefreshToken.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } })],
    ['inactive owner', async (user) => User.updateOne({ _id: user._id }, { $set: { isActive: false } })],
  ])('rejects a refresh token that is %s', async (_label, mutateSession) => {
    const owner = await createUserFixture();
    const login = await loginWithoutAgent(owner);
    const refreshCookie = cookieValue(login, 'refreshToken');
    await mutateSession(owner);

    const response = await request(testServer())
      .get('/api/v1/users/profile')
      .set('Cookie', refreshCookie);

    expect(response.status).toBe(401);
  });

  it('revokes target refresh tokens in the administrator mutation transaction', async () => {
    const { agent: actorAgent } = await createAuthenticatedAgent({ role: 'admin' });
    const { user: target } = await createAuthenticatedAgent({ role: 'admin' });
    expect(await RefreshToken.countDocuments({ user: target._id })).toBe(1);

    const response = await unsafeRequest(actorAgent, 'patch', `/api/v1/users/${target.id}`)
      .send({ role: 'citizen' });

    expect(response.status).toBe(200);
    expect(await RefreshToken.countDocuments({ user: target._id })).toBe(0);
  });

  it('rejects administrator self-demotion', async () => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'admin' });

    const response = await unsafeRequest(agent, 'patch', `/api/v1/users/${user.id}`)
      .send({ role: 'citizen' });

    expect(response.status).toBe(409);
    expect(await User.findById(user.id)).toMatchObject({ role: 'admin', isActive: true });
  });

  it('protects the final active administrator', async () => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ role: 'admin', isActive: false });

    const response = await unsafeRequest(agent, 'patch', `/api/v1/users/${user.id}`)
      .send({ isActive: false });

    expect(response.status).toBe(409);
    expect(await User.findById(user.id)).toMatchObject({ role: 'admin', isActive: true });
    expect(target.isActive).toBe(false);
  });

  it('serializes concurrent cross-demotion so one active administrator remains', async () => {
    const { agent: firstAgent, user: first } = await createAuthenticatedAgent({ role: 'admin' });
    const { agent: secondAgent, user: second } = await createAuthenticatedAgent({ role: 'admin' });

    const results = await Promise.all([
      unsafeRequest(firstAgent, 'patch', `/api/v1/users/${second.id}`).send({ role: 'citizen' }),
      unsafeRequest(secondAgent, 'patch', `/api/v1/users/${first.id}`).send({ role: 'citizen' }),
    ]);

    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => [403, 409].includes(result.status))).toHaveLength(1);
    expect(await User.countDocuments({ role: 'admin', isActive: true })).toBeGreaterThanOrEqual(1);
  });
});
