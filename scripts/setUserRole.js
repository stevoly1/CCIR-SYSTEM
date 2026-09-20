// Promotes one active account to the first administrator. Once an active
// administrator exists, all role changes must use the protected admin API.
//
// Usage: node scripts/setUserRole.js <email> [admin]
// Example: node scripts/setUserRole.js you@example.com

require('dotenv').config();
const mongoose = require('mongoose');
const { bootstrapFirstAdministrator } = require('../services/accountRetirementService');

const [, , email, role] = process.argv;

const run = async () => {
    if (!email || (role && role !== 'admin')) {
        console.error('Usage: node scripts/setUserRole.js <email> [admin]');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URL);
    const user = await bootstrapFirstAdministrator({ targetEmail: email });
    console.log(`${user.email} is now "${user.role}".`);
    await mongoose.disconnect();
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
