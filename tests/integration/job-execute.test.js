const { OutboxEntry } = require('../../models');
const registry = require('../../services/jobs/registry');
const { JobError } = require('../../services/jobs/jobError');
const { executeEntry } = require('../../services/jobs/execute');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { drainOutbox } = require('../helpers/jobs');
const { captureLogs } = require('../helpers/captureLogs');

const behaviour = { run: vi.fn(), onFinalFailure: vi.fn() };
const add = (refs = {}) => inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_exec', refs }));

describe('running one outbox entry', () => {
  beforeAll(() => registry.registerHandler('test_exec', {
    queue: 'email',
    run: (...args) => behaviour.run(...args),
    onFinalFailure: (...args) => behaviour.onFinalFailure(...args),
  }));
  beforeEach(() => {
    behaviour.run.mockReset();
    behaviour.onFinalFailure.mockReset();
  });

  it('marks a successful entry done and forgets a stored address', async () => {
    behaviour.run.mockResolvedValue(undefined);
    const entry = await add({ email: 'someone@example.test', userId: 'u1' });
    await expect(executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 3 })).resolves.toBe('done');
    const saved = await OutboxEntry.findById(entry._id);
    expect(saved).toMatchObject({ state: 'DONE', attempts: 1 });
    expect(saved.doneAt).toBeInstanceOf(Date);
    expect(saved.refs).toEqual({ userId: 'u1' });
    expect(saved.notBefore).toBeUndefined();
  });

  it('records a retryable failure and schedules the next attempt in MongoDB', async () => {
    behaviour.run.mockRejectedValue(JobError.of('PROVIDER_DOWN'));
    const entry = await add();
    const before = Date.now();
    await expect(executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 3, retryDelayMs: (n) => n * 60000 })).rejects.toMatchObject({ code: 'PROVIDER_DOWN', final: false });
    const saved = await OutboxEntry.findById(entry._id);
    expect(saved).toMatchObject({ state: 'PENDING', attempts: 1, lastErrorCode: 'PROVIDER_DOWN' });
    expect(saved.notBefore.getTime()).toBeGreaterThanOrEqual(before + 60000);
    expect(saved.notBefore.getTime()).toBeLessThan(Date.now() + 60000 + 1000);
    expect(behaviour.onFinalFailure).not.toHaveBeenCalled();
  });

  it('waits as long as the provider asks, when it says', async () => {
    behaviour.run.mockRejectedValue(JobError.of('RATE_LIMITED', { retryAfterMs: 5000 }));
    const entry = await add();
    await executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 3, retryDelayMs: () => 60000 }).catch(() => {});
    const { notBefore } = await OutboxEntry.findById(entry._id);
    expect(notBefore.getTime() - Date.now()).toBeLessThanOrEqual(5000);
    expect(notBefore.getTime() - Date.now()).toBeGreaterThan(3000);
  });

  it('fails for good on the last attempt, or at once when retrying cannot help', async () => {
    behaviour.run.mockRejectedValue(JobError.of('PROVIDER_DOWN'));
    const last = await add();
    await OutboxEntry.updateOne({ _id: last._id }, { attempts: 2 });
    await expect(executeEntry(last._id, { runKey: 0, attempt: 3, maxAttempts: 3 })).rejects.toMatchObject({ final: true });
    expect(await OutboxEntry.findById(last._id)).toMatchObject({ state: 'FAILED', attempts: 3 });

    behaviour.run.mockRejectedValue(JobError.of('REJECTED'));
    const rejected = await add();
    await expect(executeEntry(rejected._id, { runKey: 0, attempt: 1, maxAttempts: 3 })).rejects.toMatchObject({ code: 'REJECTED', final: true });
    expect(behaviour.onFinalFailure).toHaveBeenCalledTimes(2);
    expect(behaviour.onFinalFailure).toHaveBeenLastCalledWith(expect.objectContaining({ _id: rejected._id }), 'REJECTED');
  });

  it('skips done, failed, dismissed, missing and stale entries, and repeated attempts, without running them', async () => {
    const done = await add();
    await OutboxEntry.updateOne({ _id: done._id }, { state: 'DONE' });
    const failed = await add();
    await OutboxEntry.updateOne({ _id: failed._id }, { state: 'FAILED' });
    const dismissed = await add();
    await OutboxEntry.updateOne({ _id: dismissed._id }, { state: 'DISMISSED' });
    const stale = await add();
    await OutboxEntry.updateOne({ _id: stale._id }, { runKey: 1 });
    // A duplicate job for an attempt that was already recorded.
    const repeated = await add();
    await OutboxEntry.updateOne({ _id: repeated._id }, { attempts: 1 });
    for (const entry of [done, failed, dismissed, stale, repeated]) {
      await expect(executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 3 })).resolves.toBe('skipped');
    }
    await expect(executeEntry(new (require('mongoose').Types.ObjectId)(), { runKey: 0, attempt: 1, maxAttempts: 3 })).resolves.toBe('skipped');
    expect(behaviour.run).not.toHaveBeenCalled();
  });

  it('still reports the job\'s own failure when its final-failure step breaks', async () => {
    behaviour.run.mockRejectedValue(JobError.of('REJECTED'));
    behaviour.onFinalFailure.mockRejectedValue(new Error('database gone'));
    const entry = await add();
    const logs = captureLogs();
    try {
      await expect(executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 3 })).rejects.toMatchObject({ code: 'REJECTED', final: true });
    } finally {
      logs.restore();
    }
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ state: 'FAILED' });
    expect(logs.lines).toContainEqual(expect.objectContaining({ event: 'job_final_failure_step_failed', entryId: String(entry._id) }));
  });

  it('logs ids and codes only', async () => {
    behaviour.run.mockRejectedValue(new Error('provider said: someone@example.test is bad'));
    const entry = await add({ email: 'someone@example.test' });
    const logs = captureLogs();
    try {
      await executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 1 }).catch(() => {});
    } finally {
      logs.restore();
    }
    const line = logs.lines.find((l) => l.event === 'job');
    expect(line).toMatchObject({ queue: 'email', type: 'test_exec', entryId: String(entry._id), attempt: 1, outcome: 'failed', failureCode: 'INTERNAL' });
    expect(logs.text()).not.toContain('someone@example.test');
  });

  it('logs what an unexpected error was, with any address removed, so a bug can be told from an outage', async () => {
    behaviour.run.mockRejectedValue(new TypeError('E11000 duplicate key { email: "someone@example.test" } at step 3'));
    const entry = await add();
    const logs = captureLogs();
    try {
      await executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 2 }).catch(() => {});
    } finally {
      logs.restore();
    }
    const line = logs.lines.find((l) => l.event === 'job');
    expect(line).toMatchObject({ outcome: 'retrying', failureCode: 'INTERNAL', err: { type: 'TypeError' } });
    expect(line.err.message).toContain('at step 3');
    expect(line.err.stack).toContain('job-execute.test.js');
    expect(logs.text()).not.toContain('someone@example.test');
  });

  it('logs no error detail for an expected failure', async () => {
    behaviour.run.mockRejectedValue(JobError.of('PROVIDER_DOWN'));
    const entry = await add();
    const logs = captureLogs();
    try {
      await executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 2 }).catch(() => {});
    } finally {
      logs.restore();
    }
    expect(logs.lines.find((l) => l.event === 'job').err).toBeUndefined();
  });

  it('drains the outbox for tests, retrying up to maxAttempts', async () => {
    behaviour.run.mockRejectedValueOnce(JobError.of('TIMEOUT')).mockResolvedValue(undefined);
    await add();
    await drainOutbox({ maxAttempts: 2 });
    expect(await OutboxEntry.find()).toEqual([expect.objectContaining({ state: 'DONE', attempts: 2 })]);
  });
});
