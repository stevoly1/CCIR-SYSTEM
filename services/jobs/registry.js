const JOB_TYPES = require('./jobTypes');

// Job type -> { queue, run(entry), onFinalFailure?(entry, code), onRetry?(entry, session) }.
// onRetry prepares an administrator's retry inside its transaction; it throws a domain error
// (JOB_CANNOT_RETRY) when the work can no longer be done.
const handlers = new Map();

const registerHandler = (type, handler) => {
  if (!['ai', 'email'].includes(handler.queue)) throw new Error(`Job type ${type} needs a queue`);
  handlers.set(type, handler);
};

const handlerFor = (type) => {
  const handler = handlers.get(type);
  if (!handler) throw new Error(`Unknown job type ${type}`);
  return handler;
};

// The fixed map first, so the API can enqueue without loading handlers; then test registrations.
const queueOf = (type) => {
  const queue = JOB_TYPES[type] ?? handlers.get(type)?.queue;
  if (!queue) throw new Error(`Unknown job type ${type}`);
  return queue;
};

module.exports = { registerHandler, handlerFor, queueOf };
