// mongodb-memory-server picks a free port and mongod binds it a moment later. When test files run
// in parallel, another worker can take that port in between, and mongod refuses to start
// ('Port "…" already in use'). Only that failure is retried; the next start picks a new port.
const PORT_IN_USE = /already in use/i;

const startWithPortRetry = async (start, attempts = 3) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await start();
    } catch (error) {
      if (attempt >= attempts || !PORT_IN_USE.test(String(error?.message))) throw error;
    }
  }
};

module.exports = { startWithPortRetry };
