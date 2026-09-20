const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { inspectComplaintImage } = require('../../services/imageInspectionService');

const fixtures = path.join(__dirname, '..', 'fixtures', 'images');

const fileFor = async (filename, mimetype, overrides = {}) => {
  const tempFilePath = path.join(fixtures, filename);
  const stat = await fs.stat(tempFilePath);
  return {
    name: filename,
    tempFilePath,
    mimetype,
    size: stat.size,
    ...overrides,
  };
};

describe('trusted complaint image inspection', () => {
  let temporaryDirectory;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccir-image-inspection-'));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it.each([
    ['valid.jpg', 'image/jpeg', 'jpeg'],
    ['valid.png', 'image/png', 'png'],
    ['valid.webp', 'image/webp', 'webp'],
  ])('accepts fully decoded %s input', async (filename, mimetype, format) => {
    const file = await fileFor(filename, mimetype);

    await expect(inspectComplaintImage(file)).resolves.toMatchObject({
      tempFilePath: file.tempFilePath,
      format,
      mimeType: mimetype,
      width: 8,
      height: 8,
      size: file.size,
    });
  });

  it('does not trust or require a filename extension', async () => {
    const source = await fileFor('valid.jpg', 'image/jpeg');
    const renamedPath = path.join(temporaryDirectory, 'misleading.png');
    await fs.copyFile(source.tempFilePath, renamedPath);

    await expect(inspectComplaintImage({ ...source, name: 'misleading.png', tempFilePath: renamedPath }))
      .resolves.toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg' });
  });

  it('rejects MIME and signature disagreement', async () => {
    const file = await fileFor('valid.jpg', 'image/png');
    await expect(inspectComplaintImage(file)).rejects.toMatchObject({ statusCode: 415 });
  });

  it.each([
    ['vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>', 'image/svg+xml'],
    ['renamed.jpg', 'not an image', 'image/jpeg'],
    ['archive.jpg', Buffer.from('504b030414000000', 'hex'), 'image/jpeg'],
    ['photo.heic', Buffer.from('000000186674797068656963', 'hex'), 'image/heic'],
  ])('rejects unsupported or disguised input %s', async (name, contents, mimetype) => {
    const tempFilePath = path.join(temporaryDirectory, name);
    await fs.writeFile(tempFilePath, contents);
    const size = (await fs.stat(tempFilePath)).size;

    await expect(inspectComplaintImage({ name, tempFilePath, mimetype, size }))
      .rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects GIF even when it is a decodable image', async () => {
    const tempFilePath = path.join(temporaryDirectory, 'image.gif');
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).gif().toFile(tempFilePath);
    const size = (await fs.stat(tempFilePath)).size;

    await expect(inspectComplaintImage({ name: 'image.gif', tempFilePath, mimetype: 'image/gif', size }))
      .rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects truncated content after its valid signature', async () => {
    const source = await fs.readFile(path.join(fixtures, 'valid.jpg'));
    const tempFilePath = path.join(temporaryDirectory, 'truncated.jpg');
    await fs.writeFile(tempFilePath, source.subarray(0, Math.floor(source.length / 2)));
    const size = (await fs.stat(tempFilePath)).size;

    await expect(inspectComplaintImage({ name: 'truncated.jpg', tempFilePath, mimetype: 'image/jpeg', size }))
      .rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects animated WebP', async () => {
    const file = await fileFor('animated.webp', 'image/webp');
    await expect(inspectComplaintImage(file)).rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects authoritative byte size above 10 MiB', async () => {
    const tempFilePath = path.join(temporaryDirectory, 'oversized.jpg');
    await fs.writeFile(tempFilePath, Buffer.alloc(1));
    await fs.truncate(tempFilePath, (10 * 1024 * 1024) + 1);

    await expect(inspectComplaintImage({
      name: 'oversized.jpg',
      tempFilePath,
      mimetype: 'image/jpeg',
      size: (10 * 1024 * 1024) + 1,
    })).rejects.toMatchObject({ statusCode: 413 });
  });

  it('rejects decoded dimensions above 25,000,000 pixels', async () => {
    const tempFilePath = path.join(temporaryDirectory, 'too-many-pixels.png');
    await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: 'black' },
    }).png({ compressionLevel: 9 }).toFile(tempFilePath);
    const size = (await fs.stat(tempFilePath)).size;

    await expect(inspectComplaintImage({ name: 'too-many-pixels.png', tempFilePath, mimetype: 'image/png', size }))
      .rejects.toMatchObject({ statusCode: 413 });
  });

  it('rejects malformed file objects and declared-size lies', async () => {
    const valid = await fileFor('valid.png', 'image/png');
    for (const file of [null, {}, { ...valid, tempFilePath: '' }, { ...valid, size: valid.size + 1 }]) {
      await expect(inspectComplaintImage(file)).rejects.toMatchObject({ statusCode: 415 });
    }
  });
});
