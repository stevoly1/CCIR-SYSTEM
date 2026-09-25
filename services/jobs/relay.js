const { OutboxEntry } = require('../../models');
const { jobIdFor } = require('./jobId');
const { getLogger } = require('../../utils/logger');

const REOFFER_AFTER_MS = 10 * 60 * 1000;
const REOFFER_EVERY_MS = 5 * 60 * 1000;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Moves pending outbox entries into their queues. It reads MongoDB on every pass and touches Redis
// only when there is something to add, so an idle relay costs no Redis commands.
//
// Every few minutes it also offers long-queued entries again. BullMQ ignores a job id it still
// holds (waiting, delayed or running), so this only brings back jobs Redis lost, for example
// after a flush or a provider reset.
const createRelay = ({ queues, intervalMs, batchSize = 50, reofferEveryMs = REOFFER_EVERY_MS }) => {
  let timers = [];
  let running = 0;
  let outage = false;

  const guarded = async (work) => {
    running += 1;
    try {
      const moved = await work();
      if (outage) {
        outage = false;
        getLogger().info({ event: 'relay_recovered' }, 'Outbox relay reached the queue again');
      }
      return moved;
    } catch (error) {
      if (!outage) {
        outage = true;
        getLogger().warn({ event: 'relay_unavailable', err: error }, 'Outbox relay could not reach the queue; entries wait in MongoDB');
      }
      return 0;
    } finally {
      running -= 1;
    }
  };

  const offer = (entry) => queues[entry.queue].add(entry.type, { entryId: String(entry._id), runKey: entry.runKey }, { jobId: jobIdFor(entry) });

  let passing = false;
  const runOnce = async () => {
    if (passing) return 0;
    passing = true;
    try {
      return await guarded(async () => {
        const entries = await OutboxEntry.find({ state: 'PENDING', queue: { $in: Object.keys(queues) } })
          .sort({ createdAt: 1, _id: 1 }).limit(batchSize);
        let moved = 0;
        for (const entry of entries) {
          await offer(entry);
          // A fast worker may already have finished it; then this matches nothing.
          await OutboxEntry.updateOne({ _id: entry._id, state: 'PENDING', runKey: entry.runKey }, { $set: { state: 'QUEUED', queuedAt: new Date() } });
          moved += 1;
        }
        return moved;
      });
    } finally {
      passing = false;
    }
  };

  const reofferOnce = () => guarded(async () => {
    const entries = await OutboxEntry.find({
      state: 'QUEUED', queue: { $in: Object.keys(queues) }, queuedAt: { $lt: new Date(Date.now() - REOFFER_AFTER_MS) },
    }).sort({ queuedAt: 1 }).limit(batchSize);
    for (const entry of entries) {
      await offer(entry);
      await OutboxEntry.updateOne({ _id: entry._id, state: 'QUEUED', runKey: entry.runKey }, { $set: { queuedAt: new Date() } });
    }
    return entries.length;
  });

  const start = () => {
    timers = [
      setInterval(() => { void runOnce(); }, intervalMs),
      setInterval(() => { void reofferOnce(); }, reofferEveryMs),
    ];
    timers.forEach((timer) => timer.unref?.());
  };

  const stop = async () => {
    timers.forEach(clearInterval);
    timers = [];
    while (running > 0) await pause(10);
  };

  return { runOnce, reofferOnce, start, stop };
};

module.exports = { createRelay };
