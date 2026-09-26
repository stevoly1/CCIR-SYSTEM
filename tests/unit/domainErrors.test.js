const CustomAPIError = require('../../errors/customError');
const errorHandler = require('../../middleware/errorHandler');
const domainErrors = require('../../errors/domainErrors');

const EXPECTED = {
  staleComplaint: [409, 'STALE_COMPLAINT'],
  complaintNotEditable: [409, 'COMPLAINT_NOT_EDITABLE'],
  complaintWithdrawn: [409, 'COMPLAINT_WITHDRAWN'],
  notAssignedToYou: [403, 'NOT_ASSIGNED_TO_YOU'],
  noChange: [409, 'NO_CHANGE'],
  editLimitReached: [409, 'EDIT_LIMIT_REACHED'],
  categoryInactive: [409, 'CATEGORY_INACTIVE'],
  categoryNameConflict: [409, 'CATEGORY_NAME_CONFLICT'],
  categoryInUse: [409, 'CATEGORY_IN_USE'],
  categoryProtected: [409, 'CATEGORY_PROTECTED'],
  locationProviderUnavailable: [503, 'LOCATION_PROVIDER_UNAVAILABLE'],
  invalidOrExpiredToken: [400, 'INVALID_OR_EXPIRED_TOKEN'],
  googleAccount: [409, 'GOOGLE_ACCOUNT'],
  wrongPassword: [401, 'WRONG_PASSWORD'],
  samePassword: [400, 'SAME_PASSWORD'],
  sameEmail: [400, 'SAME_EMAIL'],
  emailNotVerified: [403, 'EMAIL_NOT_VERIFIED'],
  emailNotVerifiedForRole: [409, 'EMAIL_NOT_VERIFIED'],
  alreadyVerified: [409, 'ALREADY_VERIFIED'],
};

const respond = (error) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  errorHandler(error, {}, res, vi.fn());
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

describe('domain errors', () => {
  it.each(Object.entries(EXPECTED))('%s maps to its status and code through the error handler', (name, [status, code]) => {
    const error = domainErrors[name]();
    expect(error).toBeInstanceOf(CustomAPIError);
    const { status: sent, body } = respond(error);
    expect(sent).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBeTruthy();
    expect(body.msg).toBe(body.error.message);
  });

  it('exports exactly the specified factories', () => {
    expect(Object.keys(domainErrors).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('still maps an unhandled duplicate-key error to a generic conflict without key values', () => {
    const duplicate = Object.assign(new Error('E11000 dup secret-key'), { code: 11000, keyValue: { email: 'secret-key' } });
    const { status, body } = respond(duplicate);
    expect(status).toBe(409);
    expect(body.error).toEqual({ code: 'CONFLICT', message: 'Resource already exists' });
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  it('returns a fresh error instance on every call', () => {
    expect(domainErrors.staleComplaint()).not.toBe(domainErrors.staleComplaint());
  });
});
