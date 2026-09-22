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

  it('returns a fresh error instance on every call', () => {
    expect(domainErrors.staleComplaint()).not.toBe(domainErrors.staleComplaint());
  });
});
