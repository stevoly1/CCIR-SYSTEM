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

// A staff-set priority is not AI-derived, so re-analysis never overwrites it.
const reanalysisPriority = ({ complaint, ai, category }) => {
  if (complaint.prioritySource === 'STAFF') return {};
  return ai.error
    ? { priority: category.defaultPriority, prioritySource: 'CATEGORY_DEFAULT' }
    : { priority: ai.priority, prioritySource: 'AI' };
};

module.exports = {
  MAX_ANALYSES,
  MAX_EDITS,
  normaliseDescription,
  isMaterialChange,
  assertEditAllowed,
  reanalysisPriority,
};
