// Display names keep their case; `nameKey` is the case- and spacing-insensitive identity
// used for uniqueness, so "Roads", " roads " and "ROADS" are the same category.
const cleanCategoryName = (name) => String(name).trim().replace(/\s+/g, ' ');
const normaliseCategoryName = (name) => cleanCategoryName(name).toLowerCase();
const categorySlug = (name) => normaliseCategoryName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

module.exports = { cleanCategoryName, normaliseCategoryName, categorySlug };
