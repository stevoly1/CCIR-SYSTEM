const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const Busboy = require('busboy');
const { BadRequestError, PayloadTooLargeError } = require('../errors');
const { MAX_IMAGE_BYTES } = require('../services/imageInspectionService');
const { MAX_AGGREGATE_BYTES, MAX_IMAGES } = require('../services/complaintImageService');

const UPLOAD_ROOT = path.join(os.tmpdir(), 'ccir-uploads');

const addField = (target, name, value) => {
  if (!Object.hasOwn(target, name)) target[name] = value;
  else if (Array.isArray(target[name])) target[name].push(value);
  else target[name] = [target[name], value];
};

const multipartUpload = async (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();

  let uploadDirectory;
  try {
    await fsp.mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
    uploadDirectory = await fsp.mkdtemp(path.join(UPLOAD_ROOT, 'request-'));
  } catch (error) {
    return next(error);
  }

  req.body = Object.create(null);
  req.files = null;

  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_IMAGE_BYTES,
        files: MAX_IMAGES,
        fields: 20,
        parts: MAX_IMAGES + 20,
      },
    });
  } catch {
    await fsp.rm(uploadDirectory, { recursive: true, force: true });
    return next(new BadRequestError('Malformed multipart upload'));
  }

  let aggregateBytes = 0;
  let failed = false;
  let failureHandled = false;
  let failureError;
  let disconnected = false;
  let parserFinished = false;
  let cleanupPromise;
  const records = [];
  const writes = [];

  const cleanup = () => {
    cleanupPromise ||= fsp.rm(uploadDirectory, { recursive: true, force: true }).catch(() => undefined);
    return cleanupPromise;
  };
  const finishFailure = () => {
    if (failureHandled) return;
    failureHandled = true;
    void Promise.allSettled(writes)
      .then(cleanup)
      .then(() => {
        if (!disconnected) next(failureError);
      });
  };
  const abort = (error) => {
    if (failed) return;
    failed = true;
    failureError = error;
    req.once('end', finishFailure);
  };
  const abortDisconnectedRequest = () => {
    if (disconnected) return;
    disconnected = true;
    if (!failed) {
      failed = true;
      failureError = new BadRequestError('Multipart upload was interrupted');
    }
    req.unpipe(busboy);
    busboy.destroy();
    finishFailure();
  };

  req.once('aborted', abortDisconnectedRequest);
  req.once('error', () => {
    if (!parserFinished) abortDisconnectedRequest();
  });
  req.once('close', () => {
    if (!parserFinished && !req.complete && !req.readableEnded) abortDisconnectedRequest();
  });

  busboy.on('field', (name, value) => {
    if (!failed) addField(req.body, name, value);
  });

  busboy.on('file', (field, file, info) => {
    if (failed) return file.resume();
    const tempFilePath = path.join(uploadDirectory, crypto.randomUUID());
    const writer = fs.createWriteStream(tempFilePath, { flags: 'wx', mode: 0o600 });
    let size = 0;

    const aggregateLimit = new Transform({
      transform(chunk, encoding, callback) {
        if (failed) {
          callback();
          return;
        }
        aggregateBytes += chunk.length;
        size += chunk.length;
        if (aggregateBytes > MAX_AGGREGATE_BYTES) {
          abort(new PayloadTooLargeError('Complaint images exceed the 25 MiB aggregate limit'));
          callback();
          return;
        }
        callback(null, chunk);
      },
    });

    file.once('limit', () => abort(new PayloadTooLargeError('Image exceeds the 10 MiB limit')));
    const write = pipeline(file, aggregateLimit, writer)
      .then(() => {
        records.push({
          field,
          file: {
            name: info.filename,
            tempFilePath,
            mimetype: info.mimeType,
            encoding: info.encoding,
            size,
          },
        });
      })
      .catch((error) => abort(
        error instanceof PayloadTooLargeError
          ? error
          : new BadRequestError('Malformed multipart upload'),
      ));
    writes.push(write);
  });

  busboy.once('filesLimit', () => abort(
    new PayloadTooLargeError('A complaint can include at most 5 images'),
  ));
  busboy.once('partsLimit', () => abort(new BadRequestError('Multipart upload has too many parts')));
  busboy.once('fieldsLimit', () => abort(new BadRequestError('Multipart upload has too many fields')));
  busboy.once('error', () => abort(new BadRequestError('Malformed multipart upload')));
  busboy.once('finish', () => {
    parserFinished = true;
    if (failed) return finishFailure();
    void Promise.all(writes).then(() => {
      if (failed) return;
      const files = Object.create(null);
      for (const record of records) addField(files, record.field, record.file);
      req.files = Object.keys(files).length > 0 ? files : null;
      res.once('finish', cleanup);
      res.once('close', cleanup);
      next();
    });
  });

  req.pipe(busboy);
};

module.exports = multipartUpload;
