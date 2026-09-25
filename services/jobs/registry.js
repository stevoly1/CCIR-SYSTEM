// Job type -> { queue, run(entry), onFinalFailure?(entry, code), onRetry?(entry, session) }.
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

const queueOf = (type) => handlerFor(type).queue;

module.exports = { registerHandler, handlerFor, queueOf };
