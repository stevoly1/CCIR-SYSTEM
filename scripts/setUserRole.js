// Promotes (or demotes) an existing user's role. The signup endpoint always
// creates 'citizen' accounts, so this is the way to create the first admin.
//
// Usage: node scripts/setUserRole.js <email> <role>
// Example: node scripts/setUserRole.js you@example.com admin

require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../models');

const [, , email, role] = process.argv;
const VALID_ROLES = ['citizen', 'admin', 'agency'];

const run = async () => {
    if (!email || !role) {
        console.error('Usage: node scripts/setUserRole.js <email> <role>');
        console.error(`Valid roles: ${VALID_ROLES.join(', ')}`);
        process.exit(1);
    }

    if (!VALID_ROLES.includes(role)) {
        console.error(`Invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URL);

    const user = await User.findOneAndUpdate({ email }, { role }, { new: true });

    if (!user) {
        console.error(`No user found with email "${email}". Sign up first, then run this script.`);
        process.exit(1);
    }

    console.log(`${user.email} is now "${user.role}".`);
    await mongoose.disconnect();
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
