const fs = require('fs/promises');
const nodeFs = require('fs');
const os = require('os');
const path = require('path');
const { Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const complaintImageService = require('../../services/complaintImageService');
const uploadService = require('../../services/uploadService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { postMultipartAllowingEarlyResponse } = require('../helpers/earlyResponseRequest');

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
  let credentials;
  let temporaryDirectory;

  beforeEach(async () => {
    let user;
    let password;
    ({ agent, user, password } = await createAuthenticatedAgent({ role: 'citizen' }));
    credentials = { email: user.email, password };
    await createCategoryFixture({ name: 'Other' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(aiResult);
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccir-upload-test-'));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const complaintRequest = () => unsafeRequest(agent, 'post', '/api/v1/complaints')
    .field('description', 'A detailed complaint with uploaded evidence')
    .field('address', '1 Test Street');

  it('rejects six images before AI or cloud calls and cleans every temp file', async () => {
    const upload = vi.spyOn(uploadService, 'uploadComplaintImage');
    const cleanup = vi.spyOn(complaintImageService, 'cleanupTemporaryFiles');
    let request = complaintRequest();
    for (let index = 0; index < 6; index += 1) request = request.attach('image', fixture);

    const response = await request;

    expect(response.status).toBe(413);
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
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
    const cleanup = vi.spyOn(complaintImageService, 'cleanupTemporaryFiles');
    const bytesWritten = [];
    const originalCreateWriteStream = nodeFs.createWriteStream.bind(nodeFs);
    vi.spyOn(nodeFs, 'createWriteStream').mockImplementation((...args) => {
      const writer = originalCreateWriteStream(...args);
      writer.once('finish', () => bytesWritten.push(writer.bytesWritten));
      return writer;
    });
    const response = await postMultipartAllowingEarlyResponse({
      credentials,
      path: '/api/v1/complaints',
      fields: { description: 'A detailed complaint with uploaded evidence', address: '1 Test Street' },
      files: largePaths.map((filePath) => ({ field: 'image', path: filePath, contentType: 'image/jpeg' })),
    });

    expect(response.status).toBe(413);
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(bytesWritten.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(25 * 1024 * 1024);
  });

  it('rejects a single image above 10 MiB while it streams, before AI or cloud calls', async () => {
    const upload = vi.spyOn(uploadService, 'uploadComplaintImage');
    const big = path.join(temporaryDirectory, 'big.jpg');
    await fs.writeFile(big, Buffer.alloc(11 * 1024 * 1024));

    const response = await postMultipartAllowingEarlyResponse({
      credentials,
      path: '/api/v1/complaints',
      fields: { description: 'A detailed complaint with uploaded evidence', address: '1 Test Street' },
      files: [{ field: 'image', path: big, contentType: 'image/jpeg' }],
    });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(aiService.classifyComplaint).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(await Complaint.countDocuments()).toBe(0);
  });

  it('rejects a form with more than 20 fields', async () => {
    let request = complaintRequest();
    for (let index = 0; index < 20; index += 1) request = request.field(`extra${index}`, 'x');
    const response = await request.attach('image', fixture);
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Multipart upload has too many fields');
    expect(await Complaint.countDocuments()).toBe(0);
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
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: response.headers['x-request-id'] },
      msg: 'Something went wrong',
    });
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
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: response.headers['x-request-id'] },
      msg: 'Something went wrong',
    });
    expect(remove).toHaveBeenCalledWith(['one', 'two']);
  });

  it('cleans temporary files after a successful complaint upload', async () => {
    vi.spyOn(uploadService, 'uploadComplaintImage')
      .mockResolvedValueOnce({ url: 'https://example.test/one', publicId: 'one' });
    const cleanup = vi.spyOn(complaintImageService, 'cleanupTemporaryFiles');

    const response = await complaintRequest().attach('image', fixture);

    expect(response.status).toBe(201);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.calls[0][0]).toHaveLength(2);
    expect(new Set(cleanup.mock.calls[0][0].map((file) => file.tempFilePath)).size).toBe(2);
    expect(await Complaint.countDocuments()).toBe(1);
  });
});
