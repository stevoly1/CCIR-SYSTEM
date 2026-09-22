const { User, Category } = require('../../models');

const PASSWORD = 'E2e-password-1';
const ACCOUNTS = [
  ['citizen@e2e.test', 'Cara Citizen', 'citizen'],
  ['citizen2@e2e.test', 'Dayo Citizen', 'citizen'],
  ['agency-a@e2e.test', 'Ade Agency', 'agency'],
  ['agency-b@e2e.test', 'Bisi Agency', 'agency'],
  ['admin@e2e.test', 'Chi Admin', 'admin'],
];
const CATEGORIES = [['Other', 'LOW'], ['Roads', 'HIGH'], ['Drainage', 'MEDIUM'], ['Streetlights', 'LOW']];

const seed = async () => {
  for (const [email, name, role] of ACCOUNTS) {
    await User.create({ email, name, role, password: PASSWORD, isActive: true });
  }
  for (const [name, defaultPriority] of CATEGORIES) {
    await Category.create({ name, defaultPriority, isActive: true });
  }
};

module.exports = { seed, PASSWORD };
