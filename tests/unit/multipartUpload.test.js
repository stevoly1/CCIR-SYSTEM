const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const multipartUpload = require('../../middleware/multipartUpload');

const uploadRoot = path.join(os.tmpdir(), 'ccir-uploads');

const listRequestDirectories = async () => {
  try {
    return (await fs.readdir(uploadRoot)).filter((name) => name.startsWith('request-'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for multipart cleanup');
};

describe('multipart upload abort cleanup', () => {
  it('removes request storage when the client disconnects before parsing finishes', async () => {
    const before = new Set(await listRequestDirectories());
    const boundary = 'ccir-aborted-upload';
    const req = new PassThrough();
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    req.is = () => true;
    const res = new EventEmitter();
    const next = vi.fn();

    await multipartUpload(req, res, next);
    req.write(
      `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="image"; filename="partial.jpg"\r\n'
      + 'Content-Type: image/jpeg\r\n\r\npartial-image-bytes',
    );
    await waitFor(async () => (await listRequestDirectories()).some((name) => !before.has(name)));

    req.emit('aborted');

    await waitFor(async () => (await listRequestDirectories()).every((name) => before.has(name)));
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates a parser failure even when cleanup rejects', async () => {
    const before = new Set(await listRequestDirectories());
    const boundary = 'ccir-cleanup-failure';
    const req = new PassThrough();
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    req.is = () => true;
    const res = new EventEmitter();
    const cleanup = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('injected cleanup failure'));
    let nextError;
    const nextCalled = new Promise((resolve) => {
      nextError = resolve;
    });

    await multipartUpload(req, res, nextError);
    let body = '';
    for (let index = 0; index < 6; index += 1) {
      body += `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="image"; filename="${index}.jpg"\r\n`
        + 'Content-Type: image/jpeg\r\n\r\nx\r\n';
    }
    req.end(`${body}--${boundary}--\r\n`);

    const error = await Promise.race([
      nextCalled,
      new Promise((_, reject) => setTimeout(() => reject(new Error('next was not called')), 1000)),
    ]);
    expect(error).toMatchObject({ statusCode: 413 });

    cleanup.mockRestore();
    const after = await listRequestDirectories();
    await Promise.all(after.filter((name) => !before.has(name)).map((name) => (
      fs.rm(path.join(uploadRoot, name), { recursive: true, force: true })
    )));
  });
});
