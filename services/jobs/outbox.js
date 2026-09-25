const { OutboxEntry } = require('../../models');
const registry = require('./registry');

// The only way to create a job: inside the transaction that makes the change, so the two are
// saved together or not at all.
const enqueue = async (session, { queue, type, refs = {} }) => {
  if (!session) throw new Error('enqueue needs the transaction session of the change it belongs to');
  const expected = registry.queueOf(type);
  if (queue !== expected) throw new Error(`${type} runs on the ${expected} queue`);
  const [entry] = await OutboxEntry.create([{ queue, type, refs }], { session });
  return entry;
};

module.exports = { enqueue };
