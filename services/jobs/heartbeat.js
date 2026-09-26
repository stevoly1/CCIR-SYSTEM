const crypto = require('node:crypto');
const os = require('node:os');
const { WorkerHeartbeat } = require('../../models');
const { getLogger } = require('../../utils/logger');

const startHeartbeat = async ({ intervalMs = 30 * 1000 } = {}) => {
  const id = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const startedAt = new Date();
  const beat = () => WorkerHeartbeat.updateOne(
    { _id: id },
    { $set: { host: os.hostname(), pid: process.pid, startedAt, lastSeenAt: new Date() } },
    { upsert: true },
  );
  await beat();
  const timer = setInterval(() => {
    beat().catch((err) => getLogger().warn({ event: 'heartbeat_failed', err }, 'Worker heartbeat not written'));
  }, intervalMs);
  timer.unref?.();
  return {
    id,
    stop: async () => {
      clearInterval(timer);
      await WorkerHeartbeat.deleteOne({ _id: id }).catch(() => {});
    },
  };
};

module.exports = { startHeartbeat };
