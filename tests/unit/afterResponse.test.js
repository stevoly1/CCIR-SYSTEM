const { EventEmitter } = require('node:events');
const { captureLogs } = require('../helpers/captureLogs');
const { afterResponse } = require('../../utils/afterResponse');

describe('afterResponse', () => {
  it('runs the task only after the response finishes, once', async () => {
    const res = new EventEmitter();
    const task = vi.fn().mockResolvedValue(undefined);
    afterResponse(res, task);
    expect(task).not.toHaveBeenCalled();
    res.emit('finish');
    res.emit('finish');
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });

  it('logs a failed task and never throws', async () => {
    const logs = captureLogs();
    try {
      const res = new EventEmitter();
      afterResponse(res, () => Promise.reject(new Error('boom')));
      expect(() => res.emit('finish')).not.toThrow();
      await vi.waitFor(() => expect(logs.text()).toContain('Deferred task failed'));
    } finally {
      logs.restore();
    }
  });
});
