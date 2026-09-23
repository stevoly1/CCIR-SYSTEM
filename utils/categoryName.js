// Display names keep their case; `nameKey` is the case- and spacing-insensitive identity
// used for uniqueness, so "Roads", " roads " and "ROADS" are the same category.
const cleanCategoryName = (name) => String(name).trim().replace(/\s+/g, ' ');
const normaliseCategoryName = (name) => cleanCategoryName(name).toLowerCase();

module.exports = { cleanCategoryName, normaliseCategoryName };
