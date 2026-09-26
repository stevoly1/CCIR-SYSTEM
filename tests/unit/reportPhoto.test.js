const { readFirstPhoto } = require('../../services/ai/reportPhoto');

const report = (images) => ({ _id: 'c1', images });
const ok = (bytes = 'jpeg', headers = {}) => new Response(Buffer.from(bytes), { status: 200, headers });

describe('reading the first photo for classification', () => {
  it('fetches a downscaled rendition from the configured cloud by public id only', async () => {
    const fetchImpl = vi.fn(async () => ok('jpeg-bytes'));
    const photo = await readFirstPhoto(
      report([{ url: 'http://169.254.169.254/latest/meta-data', publicId: 'ccir/complaints/abc_123' }, { url: 'x', publicId: 'ccir/complaints/second' }]),
      { fetchImpl, cloudName: 'test-cloud' },
    );
    expect(photo).toEqual({ mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes') });
    const [url] = fetchImpl.mock.calls[0];
    expect(url.startsWith('https://res.cloudinary.com/test-cloud/image/upload/')).toBe(true);
    expect(url).toMatch(/c_limit/);
    expect(url).toMatch(/w_1024/);
    expect(url).toMatch(/h_1024/);
    expect(url).toContain('ccir/complaints/abc_123');
    expect(url).not.toContain('169.254');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it.each([
    ['no photo', report([])],
    ['no images field', { _id: 'c1' }],
    ['a public id with a path escape', report([{ url: 'x', publicId: '../secret' }])],
    ['a public id that is a URL', report([{ url: 'x', publicId: 'http://evil.test/a' }])],
    ['a public id with spaces', report([{ url: 'x', publicId: 'a b' }])],
  ])('reads nothing for %s', async (_, complaint) => {
    const fetchImpl = vi.fn();
    await expect(readFirstPhoto(complaint, { fetchImpl, cloudName: 'test-cloud' })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads nothing when Cloudinary is not configured', async () => {
    const fetchImpl = vi.fn();
    await expect(readFirstPhoto(report([{ url: 'x', publicId: 'ccir/a' }]), { fetchImpl, cloudName: null })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies text-only when the image is gone or too large', async () => {
    const one = report([{ url: 'x', publicId: 'ccir/a' }]);
    await expect(readFirstPhoto(one, { fetchImpl: async () => new Response('', { status: 404 }), cloudName: 'c' })).resolves.toBeNull();
    const declaredTooLarge = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(6 * 1024 * 1024) }), arrayBuffer: async () => new ArrayBuffer(1) });
    await expect(readFirstPhoto(one, { fetchImpl: declaredTooLarge, cloudName: 'c' })).resolves.toBeNull();
    await expect(readFirstPhoto(one, { fetchImpl: async () => ok('x'.repeat(5 * 1024 * 1024 + 1)), cloudName: 'c' })).resolves.toBeNull();
  });

  it('stops reading an oversized stream without buffering the whole response', async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const arrayBuffer = vi.fn(() => { throw new Error('must not buffer the whole image'); });
    const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers(), body, arrayBuffer });
    await expect(readFirstPhoto(report([{ publicId: 'ccir/a' }]), { fetchImpl, cloudName: 'c' })).resolves.toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThanOrEqual(7);
  });

  it.each([
    ['a server error', async () => new Response('', { status: 503 })],
    ['a network failure', async () => { throw new TypeError('fetch failed'); }],
  ])('asks for a retry on %s', async (_, fetchImpl) => {
    await expect(readFirstPhoto(report([{ url: 'x', publicId: 'ccir/a' }]), { fetchImpl, cloudName: 'c' }))
      .rejects.toMatchObject({ name: 'JobError', code: 'PROVIDER_DOWN' });
  });

  it('gives up on a slow image at the time limit', async () => {
    const fetchImpl = (_url, { signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); });
    await expect(readFirstPhoto(report([{ url: 'x', publicId: 'ccir/a' }]), { fetchImpl, cloudName: 'c', timeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'PROVIDER_DOWN' });
  });
});
