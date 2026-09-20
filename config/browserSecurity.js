const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const parseBrowserOrigin = (env) => {
  const rawOrigin = env.BROWSER_ORIGIN;
  if (typeof rawOrigin !== 'string' || rawOrigin.length === 0 || rawOrigin !== rawOrigin.trim()) {
    throw new Error('BROWSER_ORIGIN must be one exact URL origin');
  }

  let parsed;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error('BROWSER_ORIGIN must be one exact URL origin');
  }

  const isExactOrigin = (
    parsed.origin === rawOrigin
    && parsed.pathname === '/'
    && parsed.search === ''
    && parsed.hash === ''
    && parsed.username === ''
    && parsed.password === ''
  );
  if (!isExactOrigin || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('BROWSER_ORIGIN must be one exact URL origin');
  }
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('BROWSER_ORIGIN must use HTTPS in production');
  }
  if (
    env.NODE_ENV !== 'production'
    && parsed.protocol === 'http:'
    && !LOCAL_DEVELOPMENT_HOSTS.has(parsed.hostname)
  ) {
    throw new Error('BROWSER_ORIGIN may use HTTP only for a local development host');
  }
  return parsed.origin;
};

const parseTrustProxy = (env) => {
  const rawHops = Object.hasOwn(env, 'TRUST_PROXY_HOPS') ? env.TRUST_PROXY_HOPS : '0';
  if (typeof rawHops !== 'string' || !/^(0|[1-9]\d*)$/.test(rawHops)) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  const hops = Number(rawHops);
  if (!Number.isSafeInteger(hops)) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  return hops;
};

const getBrowserSecurityConfig = (env = process.env) => {
  const browserOrigin = parseBrowserOrigin(env);
  const trustProxy = parseTrustProxy(env);
  const cookieOptions = Object.freeze({
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    signed: true,
  });

  return {
    browserOrigin,
    trustProxy,
    cookieOptions,
    corsOptions: {
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || origin === browserOrigin);
      },
    },
  };
};

module.exports = { getBrowserSecurityConfig };
