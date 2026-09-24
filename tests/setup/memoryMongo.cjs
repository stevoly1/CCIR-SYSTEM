// mongodb-memory-server picks a free port and mongod binds it a moment later. When test files run
// in parallel, another worker can take that port in between, and mongod refuses to start
// ('Port "…" already in use'). Only that failure is retried; the next instance picks a new port.
//
// `build` returns an unstarted instance (new MongoMemoryReplSet(options)), so a failed start can be
// cleaned up: the library skips its own clean-up then, leaving an empty mongo-mem-* folder behind.
const PORT_IN_USE = /already in use/i;

const startWithPortRetry = async (build, attempts = 3) => {
  for (let attempt = 1; ; attempt += 1) {
    const instance = build();
    try {
      await instance.start();
      return instance;
    } catch (error) {
      await instance.stop({ doCleanup: true, force: true }).catch(() => {});
      if (attempt >= attempts || !PORT_IN_USE.test(String(error?.message))) throw error;
    }
  }
};

module.exports = { startWithPortRetry };
