// Where a Google sign-in may return: a dashboard path on this site, nothing else. The value is
// appended to the configured client origin, and anything doubtful is dropped rather than refused.
const safeReturnPath = (value) => {
  if (typeof value !== 'string' || value.length > 512) return null;
  if (!/^\/dashboard(?:$|[/?#])/.test(value)) return null;
  if (value.includes('//') || /[\\\u0000-\u001f\u007f]/.test(value) || /%2f|%5c|%2e/i.test(value)) return null;
  if (/\/\.{1,2}(?:$|[/?#])/.test(value)) return null;
  return value;
};

module.exports = { safeReturnPath };
