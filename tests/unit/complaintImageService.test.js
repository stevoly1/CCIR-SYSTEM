const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const cloudinary = require('../../config/cloudinary');
const imageInspectionService = require('../../services/imageInspectionService');
const uploadService = require('../../services/uploadService');
const {
  cleanupCloudImages,
  cleanupTemporaryFiles,
  prepareComplaintImages,
  uploadComplaintImages,
} = require('../../services/complaintImageService');
const { captureLogs } = require('../helpers/captureLogs');

const image = (index, size = 1024) => ({
  name: `image-${index}.jpg`,
  tempFilePath: `/tmp/image-${index}.jpg`,
  mimetype: 'image/jpeg',
  size,
});

describe('complaint image orchestration', () => {
  it('rejects six files before inspection', async () => {
    const inspect = vi.spyOn(imageInspectionService, 'inspectComplaintImage');
    await expect(prepareComplaintImages(Array.from({ length: 6 }, (_, index) => image(index))))
      .rejects.toMatchObject({ statusCode: 413 });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects aggregate size above 25 MiB before inspection', async () => {
    const inspect = vi.spyOn(imageInspectionService, 'inspectComplaintImage');
    const files = [image(1, 9 * 1024 * 1024), image(2, 9 * 1024 * 1024), image(3, 9 * 1024 * 1024)];

    await expect(prepareComplaintImages(files)).rejects.toMatchObject({ statusCode: 413 });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('inspects every file before returning canonical inputs', async () => {
    const inspect = vi.spyOn(imageInspectionService, 'inspectComplaintImage')
      .mockImplementation(async (file) => ({ ...file, format: 'jpeg', mimeType: 'image/jpeg' }));
    const files = [image(1), image(2)];

    const prepared = await prepareComplaintImages(files);

    expect(inspect).toHaveBeenCalledTimes(2);
    expect(prepared).toHaveLength(2);
  });

  it('removes canonical files when later inspection fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccir-canonical-cleanup-'));
    const canonicalPath = path.join(directory, 'canonical.jpg');
    await fs.writeFile(canonicalPath, 'canonical');
    vi.spyOn(imageInspectionService, 'inspectComplaintImage')
      .mockResolvedValueOnce({ ...image(1), tempFilePath: canonicalPath, size: 9 })
      .mockRejectedValueOnce(new Error('decode failed'));

    await expect(prepareComplaintImages([image(1), image(2)])).rejects.toThrow('decode failed');
    await expect(fs.access(canonicalPath)).rejects.toThrow();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('removes canonical files when re-encoding exceeds the aggregate limit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccir-canonical-limit-'));
    const paths = [path.join(directory, 'one.jpg'), path.join(directory, 'two.jpg')];
    await Promise.all(paths.map((filePath) => fs.writeFile(filePath, 'canonical')));
    vi.spyOn(imageInspectionService, 'inspectComplaintImage')
      .mockResolvedValueOnce({ ...image(1), tempFilePath: paths[0], size: 13 * 1024 * 1024 })
      .mockResolvedValueOnce({ ...image(2), tempFilePath: paths[1], size: 13 * 1024 * 1024 });

    await expect(prepareComplaintImages([image(1), image(2)]))
      .rejects.toMatchObject({ statusCode: 413 });
    await Promise.all(paths.map((filePath) => expect(fs.access(filePath)).rejects.toThrow()));
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('deletes successful uploads when the third upload fails', async () => {
    const originalError = new Error('third upload failed');
    vi.spyOn(uploadService, 'uploadComplaintImage')
      .mockResolvedValueOnce({ url: 'https://example.test/one', publicId: 'one' })
      .mockResolvedValueOnce({ url: 'https://example.test/two', publicId: 'two' })
      .mockRejectedValueOnce(originalError);
    const remove = vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue([]);

    await expect(uploadComplaintImages([image(1), image(2), image(3)])).rejects.toBe(originalError);
    expect(remove).toHaveBeenCalledWith(['one', 'two']);
  });

  it('logs the failed cleanup count without throwing from cloud cleanup', async () => {
    vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue(['two']);
    const logs = captureLogs();

    await expect(cleanupCloudImages([{ publicId: 'one' }, { publicId: 'two' }])).resolves.toEqual(['two']);
    expect(logs.lines).toEqual([expect.objectContaining({ level: 50, failedCount: 1, msg: 'Cloud image cleanup failed' })]);
    logs.restore();
  });

  it('attempts every cloud deletion and returns only failed public IDs', async () => {
    const destroy = vi.spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValueOnce({ result: 'ok' })
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce({ result: 'ok' });

    await expect(uploadService.deleteComplaintImages(['one', 'two', 'three'])).resolves.toEqual(['two']);
    expect(destroy).toHaveBeenCalledTimes(3);
  });

  it('attempts to unlink every valid temporary path', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccir-image-cleanup-'));
    const paths = [path.join(directory, 'one'), path.join(directory, 'two')];
    await Promise.all(paths.map((filePath) => fs.writeFile(filePath, 'temporary')));

    await cleanupTemporaryFiles([
      { tempFilePath: paths[0] },
      null,
      { tempFilePath: '' },
      { tempFilePath: paths[1] },
    ]);

    await Promise.all(paths.map((filePath) => expect(fs.access(filePath)).rejects.toThrow()));
    await fs.rm(directory, { recursive: true, force: true });
  });
});
