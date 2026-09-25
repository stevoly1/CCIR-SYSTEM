const mongoose = require('mongoose');

// One MongoDB transaction around work(session). MongoDB may run work again after a transient
// error, so work must be safe to repeat.
const inTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = { inTransaction };
