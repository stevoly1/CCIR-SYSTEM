import { readLinkToken, clearLinkFragment } from './linkToken';

describe('link token', () => {
  it('reads the token from #token=…', () => {
    expect(readLinkToken('#token=abc_DEF-123')).toBe('abc_DEF-123');
    expect(readLinkToken('#x=1&token=abc')).toBe('abc');
  });

  it('gives null without a usable token', () => {
    for (const hash of ['', '#', '#token=', '#token=a%20b', '#other=abc']) expect(readLinkToken(hash)).toBeNull();
  });

  it('removes the fragment from the address bar, keeping the path and query', () => {
    window.history.replaceState(null, '', '/reset-password?x=1#token=abc');
    clearLinkFragment();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/reset-password?x=1');
  });
});
