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

  it('logs failed public IDs without throwing from cloud cleanup', async () => {
    vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue(['two']);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(cleanupCloudImages([{ publicId: 'one' }, { publicId: 'two' }])).resolves.toEqual(['two']);
    expect(log).toHaveBeenCalledWith('Cloud image cleanup failed:', ['two']);
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
