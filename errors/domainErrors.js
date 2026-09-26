const CustomAPIError = require('./customError');

const make = (status, code, message) => () => new CustomAPIError(message, status, code);

module.exports = {
  staleComplaint: make(409, 'STALE_COMPLAINT', 'This report changed; reload it and try again'),
  complaintNotEditable: make(409, 'COMPLAINT_NOT_EDITABLE', 'Only pending reports can be changed by their reporter'),
  complaintWithdrawn: make(409, 'COMPLAINT_WITHDRAWN', 'Withdrawn reports can no longer be assigned or updated by staff'),
  notAssignedToYou: make(403, 'NOT_ASSIGNED_TO_YOU', 'Only the assigned staff member can update this report'),
  noChange: make(409, 'NO_CHANGE', 'The update does not change the report'),
  editLimitReached: make(409, 'EDIT_LIMIT_REACHED', 'This report has reached its edit limit'),
  categoryInactive: make(409, 'CATEGORY_INACTIVE', 'The selected category is not available'),
  categoryNameConflict: make(409, 'CATEGORY_NAME_CONFLICT', 'A category with this name already exists'),
  categoryInUse: make(409, 'CATEGORY_IN_USE', 'Only an inactive category with no reports can be deleted'),
  categoryProtected: make(409, 'CATEGORY_PROTECTED', 'Other is the required active fallback category'),
  invalidOrExpiredToken: make(400, 'INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired; request a new one'),
  googleAccount: make(409, 'GOOGLE_ACCOUNT', 'This account signs in with Google, which manages its password and email address'),
  wrongPassword: make(401, 'WRONG_PASSWORD', 'The current password is incorrect'),
  samePassword: make(400, 'SAME_PASSWORD', 'The new password must differ from the current one'),
  sameEmail: make(400, 'SAME_EMAIL', 'This is already the account\'s email address'),
  emailNotVerified: make(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to report issues; we sent you a link'),
  emailNotVerifiedForRole: make(409, 'EMAIL_NOT_VERIFIED', "Verify this account's email address before giving it a staff role"),
  alreadyVerified: make(409, 'ALREADY_VERIFIED', 'This email address is already verified'),
  locationProviderUnavailable: make(503, 'LOCATION_PROVIDER_UNAVAILABLE', 'Location lookup is temporarily unavailable; type the address instead'),
};
