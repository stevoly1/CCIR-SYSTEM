const { OutboxEntry, User } = require('../../models');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const registry = require('../../services/jobs/registry');

describe('outbox', () => {
  beforeAll(() => registry.registerHandler('test_noop', { queue: 'email', run: async () => {} }));

  it('writes the entry with the change, in one transaction', async () => {
    await inTransaction(async (session) => {
      await User.create([{ name: 'Olu Outbox', email: 'olu@example.test', password: 'Example-pass-1' }], { session });
      await enqueue(session, { queue: 'email', type: 'test_noop', refs: { note: 'x' } });
    });
    const [entry] = await OutboxEntry.find();
    expect(entry).toMatchObject({ queue: 'email', type: 'test_noop', state: 'PENDING', runKey: 0, attempts: 0 });
    expect(entry.refs).toEqual({ note: 'x' });
    expect(await User.countDocuments()).toBe(1);
  });

  it('keeps neither when the transaction fails', async () => {
    await expect(inTransaction(async (session) => {
      await User.create([{ name: 'Olu Outbox', email: 'olu@example.test', password: 'Example-pass-1' }], { session });
      await enqueue(session, { queue: 'email', type: 'test_noop', refs: {} });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await User.countDocuments()).toBe(0);
    expect(await OutboxEntry.countDocuments()).toBe(0);
  });

  it('refuses an entry outside a transaction, or of an unknown type or the wrong queue', async () => {
    await expect(enqueue(undefined, { queue: 'email', type: 'test_noop' })).rejects.toThrow(/transaction session/);
    await expect(inTransaction((session) => enqueue(session, { queue: 'email', type: 'no_such_type' }))).rejects.toThrow(/Unknown job type no_such_type/);
    await expect(inTransaction((session) => enqueue(session, { queue: 'ai', type: 'test_noop' }))).rejects.toThrow(/test_noop runs on the email queue/);
    expect(await OutboxEntry.countDocuments()).toBe(0);
  });

  it('declares the indexes the relay, the Jobs page and retention need', () => {
    const keys = OutboxEntry.schema.indexes().map(([fields, options]) => [fields, options?.expireAfterSeconds]);
    expect(keys).toEqual(expect.arrayContaining([
      [{ state: 1, createdAt: 1 }, undefined],
      [{ queue: 1, state: 1, lastErrorAt: -1 }, undefined],
      [{ doneAt: 1 }, 7 * 24 * 3600],
      [{ dismissedAt: 1 }, 30 * 24 * 3600],
    ]));
  });
});
