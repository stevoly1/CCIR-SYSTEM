// Test-only: with OPENAPI_VALIDATE=true every response is checked against the contract and every
// documented operation that is called is recorded. Production never sets the variable, so the
// validator (a development dependency) is never loaded there.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONTRACT_PATH } = require('../utils/openapi');

const RECORD_DIR = path.join(os.tmpdir(), 'ccir-openapi-coverage');

const append = (file, entry) => {
  fs.mkdirSync(RECORD_DIR, { recursive: true });
  fs.appendFileSync(path.join(RECORD_DIR, `${process.pid}-${file}.jsonl`), `${JSON.stringify(entry)}\n`);
};

const contractTestMiddleware = () => {
  if (process.env.OPENAPI_VALIDATE !== 'true') return [];
  // eslint-disable-next-line global-require -- loaded only when contract checking is on
  const OpenApiValidator = require('express-openapi-validator');
  const recorder = (req, res, next) => {
    res.on('finish', () => {
      if (req.openapi?.openApiRoute) append('calls', { operation: `${req.method} ${req.openapi.openApiRoute.replace(/^\/api\/v1/, '')}` });
    });
    next();
  };
  // The validator checks the object handed to res.json, before serialisation. This wrapper, added
  // after the validator's own, runs first and hands it exactly what goes on the wire (ObjectIds as
  // strings, documents in their toJSON form), the same JSON.stringify that Express applies.
  const asWireJson = (req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => send(body === undefined ? body : JSON.parse(JSON.stringify(body)));
    next();
  };
  return [
    recorder,
    OpenApiValidator.middleware({
      apiSpec: CONTRACT_PATH,
      validateRequests: false, // negative tests must still reach the app's own validation
      validateResponses: {
        onError: (error, body, req) => append('failures', {
          operation: `${req.method} ${req.originalUrl.split('?')[0]}`,
          status: error.status,
          message: error.message,
        }),
      },
      validateSecurity: false,
      ignoreUndocumented: true,
      fileUploader: false,
    }),
    asWireJson,
  ];
};

module.exports = { contractTestMiddleware, RECORD_DIR };
