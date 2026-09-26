const os = require('node:os');
const { Complaint, SchedulerLease } = require('../../models');
const { inTransaction } = require('../../utils/transaction');
const { requestClassification } = require('../classificationRequests');
const { getLogger } = require('../../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_ID = 'ai-sweep';
const RETRYABLE = ['TIMEOUT', 'RATE_LIMITED', 'PROVIDER_DOWN'];

const claimDailySweep = async (now, holder) => {
  try {
    await SchedulerLease.updateOne({ _id: SWEEP_ID }, { $setOnInsert: { nextRunAt: now } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const claimed = await SchedulerLease.findOneAndUpdate(
    { _id: SWEEP_ID, nextRunAt: { $lte: now } },
    { $set: { nextRunAt: new Date(now.getTime() + DAY_MS), claimedAt: now, holder } },
  );
  return Boolean(claimed);
};

const sweepFailedClassifications = async ({ now, limit = 50 }) => {
  const before = new Date(now.getTime() - DAY_MS);
  const candidates = await Complaint.find({
    'ai.status': 'FAILED', 'ai.failureCode': { $in: RETRYABLE }, 'ai.failedAt': { $lt: before },
    status: { $ne: 'WITHDRAWN' },
  }).sort({ 'ai.failedAt': 1 }).limit(limit).select('_id ai.requestSeq');
  let requeued = 0;
  for (const { _id, ai } of candidates) {
    const again = await inTransaction((session) => requestClassification({
      session, complaintId: _id,
      where: {
        status: { $ne: 'WITHDRAWN' }, 'ai.status': 'FAILED', 'ai.requestSeq': ai.requestSeq,
        'ai.failureCode': { $in: RETRYABLE }, 'ai.failedAt': { $lt: before },
      },
    }));
    if (again) requeued += 1;
  }
  getLogger().info({ event: 'ai_sweep', candidates: candidates.length, requeued }, 'Failed classifications asked again');
  return { requeued };
};

const startAiSweep = ({ intervalMs = 60 * 60 * 1000, holder = `${os.hostname()}:${process.pid}` } = {}) => {
  let running = null;
  const tick = () => {
    running ??= (async () => {
      try {
        if (await claimDailySweep(new Date(), holder)) await sweepFailedClassifications({ now: new Date() });
      } catch {
        getLogger().warn({ event: 'ai_sweep_failed' }, 'The daily classification sweep failed; the next check tries again');
      } finally {
        running = null;
      }
    })();
    return running;
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return { stop: async () => { clearInterval(timer); await running; } };
};

module.exports = { claimDailySweep, sweepFailedClassifications, startAiSweep };
