const FALLBACK_NAME = 'Other';

// Phase 1 precedence, unchanged: AI failure -> Other; a validated active hint;
// the active category matching the AI output; otherwise Other.
const chooseCategory = ({ ai, activeCategories, hint }) => {
  const fallback = activeCategories.find((category) => category.name === FALLBACK_NAME);
  if (!fallback) throw new Error('Active Other category is not configured');
  if (ai.error) return fallback;
  if (hint) return hint;
  const wanted = ai.category?.toLowerCase();
  return activeCategories.find((category) => category.name.toLowerCase() === wanted) ?? fallback;
};

module.exports = { FALLBACK_NAME, chooseCategory };
