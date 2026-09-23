const { Category } = require('../models');
const { categorySlug, normaliseCategoryName } = require('./categoryName');

const DEFAULT_CATEGORIES = [
    { name: 'Pothole', description: 'Damaged or eroded road surfaces', defaultPriority: 'HIGH' },
    { name: 'Streetlight', description: 'Broken or malfunctioning streetlights', defaultPriority: 'MEDIUM' },
    { name: 'Drainage', description: 'Blocked or overflowing drainage systems', defaultPriority: 'HIGH' },
    { name: 'Water Leakage', description: 'Leaking or burst water pipes/mains', defaultPriority: 'HIGH' },
    { name: 'Waste Accumulation', description: 'Uncollected garbage or illegal dumping', defaultPriority: 'MEDIUM' },
    { name: 'Other', description: 'Issues that do not fit another category', defaultPriority: 'LOW' },
];

// Upserts bypass the model's validate hook, so the identity fields are written here too;
// without them the rows collide on the unique `slug` index and escape the unique `nameKey`.
// The exact-name match also finds legacy rows that predate `nameKey` (the server starts
// before `migrate:phase2` runs), so they are never duplicated.
// A duplicate key after which the default exists means another instance inserted it first.
// (The server does not retry $or upserts the way it retries equality-filter upserts.)
// A different row holding the slug is a real conflict and still fails startup loudly.
const upsertDefault = async (category) => {
    const match = { $or: [{ nameKey: normaliseCategoryName(category.name) }, { name: category.name }] };
    try {
        await Category.updateOne(
            match,
            { $setOnInsert: { ...category, nameKey: normaliseCategoryName(category.name), slug: categorySlug(category.name), isActive: true } },
            { upsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000 || !(await Category.exists(match))) throw error;
    }
};

// Safe to call on every startup. `Other` (the protected AI fallback) is always ensured. The
// other defaults are seeded only into an empty collection, so a default an administrator
// has renamed or deleted is not brought back by the next restart.
const seedDefaultCategories = async () => {
    const firstRun = (await Category.estimatedDocumentCount()) === 0;
    for (const category of DEFAULT_CATEGORIES) {
        if (firstRun || category.name === 'Other') await upsertDefault(category);
    }
};

module.exports = seedDefaultCategories;
