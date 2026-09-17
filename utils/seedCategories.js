const { Category } = require('../models');

const DEFAULT_CATEGORIES = [
    { name: 'Pothole', description: 'Damaged or eroded road surfaces', defaultPriority: 'HIGH' },
    { name: 'Streetlight', description: 'Broken or malfunctioning streetlights', defaultPriority: 'MEDIUM' },
    { name: 'Drainage', description: 'Blocked or overflowing drainage systems', defaultPriority: 'HIGH' },
    { name: 'Water Leakage', description: 'Leaking or burst water pipes/mains', defaultPriority: 'HIGH' },
    { name: 'Waste Accumulation', description: 'Uncollected garbage or illegal dumping', defaultPriority: 'MEDIUM' },
    { name: 'Other', description: 'Issues that do not fit another category', defaultPriority: 'LOW' },
];

// Idempotent — safe to call on every startup. Ensures a fresh deployment always has a
// usable category set for the AI classifier and citizen-facing forms to target.
const seedDefaultCategories = async () => {
    for (const category of DEFAULT_CATEGORIES) {
        await Category.updateOne(
            { name: category.name },
            { $setOnInsert: category },
            { upsert: true }
        );
    }
};

module.exports = seedDefaultCategories;
