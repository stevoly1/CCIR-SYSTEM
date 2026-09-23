const { Writable } = require('node:stream');
const { createLogger, useLogger } = require('../../utils/logger');

// Routes every log line written through getLogger() into memory until restore() is called.
const captureLogs = (level = 'debug') => {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunk.toString().split('\n').filter(Boolean).forEach((line) => lines.push(JSON.parse(line)));
      callback();
    },
  });
  const restore = useLogger(createLogger({ destination, level }));
  return { lines, text: () => lines.map((line) => JSON.stringify(line)).join('\n'), restore };
};

module.exports = { captureLogs };
