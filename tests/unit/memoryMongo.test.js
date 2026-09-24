const { startWithPortRetry } = require('../setup/memoryMongo.cjs');

// mongodb-memory-server picks a free port, then mongod binds it later; a parallel test worker can
// take the port in between ("Port "50879" already in use"), which skipped a whole integration file.
const portError = () => Object.assign(new Error('Port "50879" already in use'), { name: 'StdoutInstanceError' });

describe('startWithPortRetry', () => {
  it('starts again with a fresh port when the chosen port was taken', async () => {
    const start = vi.fn().mockRejectedValueOnce(portError()).mockResolvedValueOnce('server');
    await expect(startWithPortRetry(start)).resolves.toBe('server');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts, with the last port error', async () => {
    const start = vi.fn().mockRejectedValue(portError());
    await expect(startWithPortRetry(start)).rejects.toThrow('already in use');
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('never retries any other failure', async () => {
    const start = vi.fn().mockRejectedValue(new Error('binary download failed'));
    await expect(startWithPortRetry(start)).rejects.toThrow('binary download failed');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
