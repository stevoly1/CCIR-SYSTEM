const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const complaintImageService = require('../../services/complaintImageService');
const uploadService = require('../../services/uploadService');
const { createAuthenticatedAgent } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');

const fixture = path.join(__dirname, '..', 'fixtures', 'images', 'valid.jpg');
const aiResult = {
  category: 'Other',
  priority: 'MEDIUM',
  summary: 'Road damage',
  tags: ['road'],
  confidence: 0.8,
  error: null,
};

describe('complaint upload ordering and compensation', () => {
  let agent;
  let temporaryDirectory;

  beforeEach(async () => {
    ({ agent } = await createAuthenticatedAgent({ role: 'citizen' }));
    await createCategoryFixture({ name: 'Other' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(aiResult);
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccir-upload-test-'));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const complaintRequest = () => agent
    .post('/api/v1/complaints')
    .field('description', 'A detailed complaint with uploaded evidence');

  it('rejects six images before AI or cloud calls and cleans every temp file', async () => {
    const upload = vi.spyOn(uploadService, 'uploadComplaintImage');
    const cleanup = vi.spyOn(complaintImageService, 'cleanupTemporaryFiles');
    let request = complaintRequest();
    for (let index = 0; index < 6; index += 1) request = request.attach('image', fixture);

    const response = await request;

    expect(response.status).toBe(413);
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ tempFilePath: expect.any(String) }),
    ]));
    expect(cleanup.mock.calls[0][0]).toHaveLength(6);
  });

  it('rejects aggregate size above 25 MiB before AI or cloud calls', async () => {
    const largePaths = [];
    for (let index = 0; index < 3; index += 1) {
      const filePath = path.join(temporaryDirectory, `large-${index}.jpg`);
      const handle = await fs.open(filePath, 'w');
      await handle.write(Buffer.from([0xff, 0xd8, 0xff]));
      await handle.truncate(9 * 1024 * 1024);
      await handle.close();
      largePaths.push(filePath);
    }
    const upload = vi.spyOn(uploadService, 'uploadComplaintImage');
    let request = complaintRequest();
    for (const filePath of largePaths) request = request.attach('image', filePath, { contentType: 'image/jpeg' });

    const response = await request;

    expect(response.status).toBe(413);
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects unexpected file fields and invalid content before AI or cloud calls', async () => {
    const upload = vi.spyOn(uploadService, 'uploadComplaintImage');
    const unexpected = await complaintRequest().attach('avatar', fixture);
    expect(unexpected.status).toBe(415);
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();

    vi.mocked(aiService.classifyComplaint).mockClear();
    const invalidPath = path.join(temporaryDirectory, 'invalid.jpg');
    await fs.writeFile(invalidPath, 'not an image');
    const invalid = await complaintRequest().attach('image', invalidPath, { contentType: 'image/jpeg' });
    expect(invalid.status).toBe(415);
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('compensates successful uploads when a later upload fails', async () => {
    const originalError = new Error('cloud upload failed');
    vi.spyOn(uploadService, 'uploadComplaintImage')
      .mockResolvedValueOnce({ url: 'https://example.test/one', publicId: 'one' })
      .mockResolvedValueOnce({ url: 'https://example.test/two', publicId: 'two' })
      .mockRejectedValueOnce(originalError);
    const remove = vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue([]);

    const response = await complaintRequest()
      .attach('image', fixture)
      .attach('image', fixture)
      .attach('image', fixture);

    expect(response.status).toBe(500);
    expect(response.body.msg).toBe('cloud upload failed');
    expect(remove).toHaveBeenCalledWith(['one', 'two']);
    expect(await Complaint.countDocuments()).toBe(0);
  });

  it('deletes every cloud image when complaint persistence fails', async () => {
    vi.spyOn(uploadService, 'uploadComplaintImage')
      .mockResolvedValueOnce({ url: 'https://example.test/one', publicId: 'one' })
      .mockResolvedValueOnce({ url: 'https://example.test/two', publicId: 'two' });
    const remove = vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue([]);
    vi.spyOn(Complaint, 'create').mockRejectedValueOnce(new Error('database write failed'));

    const response = await complaintRequest().attach('image', fixture).attach('image', fixture);

    expect(response.status).toBe(500);
    expect(response.body.msg).toBe('database write failed');
    expect(remove).toHaveBeenCalledWith(['one', 'two']);
  });

  it('cleans temporary files after a successful complaint upload', async () => {
    vi.spyOn(uploadService, 'uploadComplaintImage')
      .mockResolvedValueOnce({ url: 'https://example.test/one', publicId: 'one' });
    const cleanup = vi.spyOn(complaintImageService, 'cleanupTemporaryFiles');

    const response = await complaintRequest().attach('image', fixture);

    expect(response.status).toBe(201);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toHaveLength(1);
    expect(await Complaint.countDocuments()).toBe(1);
  });
});
