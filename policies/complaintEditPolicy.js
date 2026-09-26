const { editLimitReached } = require('../errors/domainErrors');

// One initial analysis plus five re-analyses bounds AI cost; twenty accepted edits
// bounds the audit trail without ever dropping entries from it.
const MAX_ANALYSES = 6;
const MAX_EDITS = 20;

const normaliseDescription = (text) => String(text).trim().replace(/\s+/g, ' ');

// Whitespace-only changes are not material; any other change (including case) is.
const isMaterialChange = (before, after) => after !== undefined
  && normaliseDescription(after) !== normaliseDescription(before);

const assertEditAllowed = ({ complaint, material }) => {
  if ((complaint.editHistory?.length ?? 0) >= MAX_EDITS) throw editLimitReached();
  if (material && (complaint.ai?.analysisCount ?? 1) >= MAX_ANALYSES) throw editLimitReached();
};

module.exports = {
  MAX_ANALYSES,
  MAX_EDITS,
  normaliseDescription,
  isMaterialChange,
  assertEditAllowed,
};
