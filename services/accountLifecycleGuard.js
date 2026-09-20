const { AdminControl } = require('../models');

const CONTROL_ID = 'administrator-lifecycle';

const ensureAccountLifecycleGuard = async () => {
  try {
    await AdminControl.updateOne(
      { _id: CONTROL_ID },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
};

const touchAccountLifecycleGuard = (session) => AdminControl.updateOne(
  { _id: CONTROL_ID },
  { $inc: { revision: 1 } },
  { session },
);

module.exports = { ensureAccountLifecycleGuard, touchAccountLifecycleGuard };
