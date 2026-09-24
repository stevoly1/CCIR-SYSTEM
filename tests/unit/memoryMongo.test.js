const { startWithPortRetry } = require('../setup/memoryMongo.cjs');

// mongodb-memory-server picks a free port, then mongod binds it later; a parallel test worker can
// take the port in between ("Port "50879" already in use"), which skipped a whole integration file.
const portError = () => Object.assign(new Error('Port "50879" already in use'), { name: 'StdoutInstanceError' });

// An unstarted instance whose start() follows the given outcomes, recording its clean-ups.
const instances = [];
const buildWith = (...outcomes) => vi.fn(() => {
  const outcome = outcomes[Math.min(instances.length, outcomes.length - 1)];
  const instance = {
    start: vi.fn(async () => { if (outcome instanceof Error) throw outcome; }),
    stop: vi.fn(async () => true),
  };
  instances.push(instance);
  return instance;
});

describe('startWithPortRetry', () => {
  beforeEach(() => { instances.length = 0; });

  it('starts again with a fresh instance when the chosen port was taken', async () => {
    const build = buildWith(portError(), 'ok');
    const started = await startWithPortRetry(build);
    expect(started).toBe(instances[1]);
    expect(build).toHaveBeenCalledTimes(2);
  });

  // The library skips its own clean-up after a failed start, leaving an empty mongo-mem-* folder.
  it('cleans up each failed instance, forcing removal of its temporary folder', async () => {
    await startWithPortRetry(buildWith(portError(), 'ok'));
    expect(instances[0].stop).toHaveBeenCalledWith({ doCleanup: true, force: true });
    expect(instances[1].stop).not.toHaveBeenCalled();
  });

  it('gives up after three attempts, with the last port error, cleaning up every one', async () => {
    const build = buildWith(portError());
    await expect(startWithPortRetry(build)).rejects.toThrow('already in use');
    expect(build).toHaveBeenCalledTimes(3);
    expect(instances.every((instance) => instance.stop.mock.calls.length === 1)).toBe(true);
  });

  it('never retries any other failure, but still cleans up', async () => {
    const build = buildWith(new Error('binary download failed'));
    await expect(startWithPortRetry(build)).rejects.toThrow('binary download failed');
    expect(build).toHaveBeenCalledTimes(1);
    expect(instances[0].stop).toHaveBeenCalledWith({ doCleanup: true, force: true });
  });

  it('reports the start failure, not a failure of the clean-up', async () => {
    const build = vi.fn(() => ({ start: vi.fn().mockRejectedValue(new Error('binary download failed')), stop: vi.fn().mockRejectedValue(new Error('cleanup failed')) }));
    await expect(startWithPortRetry(build)).rejects.toThrow('binary download failed');
  });
});
