const { EventEmitter } = require('node:events');
const http = require('node:http');
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

  // A real server and socket: the caller must not be able to cancel the task by hanging up.
  describe('over a real connection', () => {
    let server;
    afterEach(() => new Promise((resolve) => { server.close(resolve); }));

    const serve = (handler) => new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    const hangUp = (port) => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' });
      req.on('error', () => {});
      setTimeout(() => { req.destroy(); resolve(); }, 50);
    });

    it('runs the task once after a normal answer', async () => {
      const task = vi.fn();
      const port = await serve((req, res) => { afterResponse(res, task); res.end('ok'); });
      await new Promise((resolve) => { http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { r.resume(); r.on('end', resolve); }); });
      await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('runs the task when the caller hangs up before the answer', async () => {
      const task = vi.fn();
      let answer;
      const port = await serve((req, res) => { afterResponse(res, task); answer = () => res.end('late'); });
      await hangUp(port);
      await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
      answer();
    });

    it('runs the task when it is registered after the caller has hung up', async () => {
      const task = vi.fn();
      let closed;
      const hungUp = new Promise((resolve) => { closed = resolve; });
      const port = await serve(async (req, res) => {
        res.on('close', closed);
        await hungUp; // the handler is still working (say, sending an email) when the caller leaves
        afterResponse(res, task);
        res.end('late');
      });
      await hangUp(port);
      await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    });
  });
});
