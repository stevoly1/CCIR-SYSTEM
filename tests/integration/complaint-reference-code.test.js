const path = require('node:path');
const { Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const uploadService = require('../../services/uploadService');
const referenceService = require('../../services/complaintReferenceService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');

const imageFixture = path.join(__dirname, '..', 'fixtures', 'images', 'valid.jpg');
const ai = (category) => ({ category, priority: 'HIGH', summary: 's', tags: [], confidence: 0.9, error: null });

describe('complaint reference codes', () => {
  let agent;

  beforeEach(async () => {
    ({ agent } = await createAuthenticatedAgent({ role: 'citizen' }));
    await createCategoryFixture({ name: 'Other', defaultPriority: 'LOW' });
    await createCategoryFixture({ name: 'Roads', defaultPriority: 'HIGH' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(ai('Roads'));
  });

  const file = () => unsafeRequest(agent, 'post', '/api/v1/complaints')
    .send({ description: 'Pothole damaging tyres on the bypass', address: '1 Bypass Road' });

  const fileWithPhoto = () => unsafeRequest(agent, 'post', '/api/v1/complaints')
    .field('description', 'Pothole damaging tyres on the bypass')
    .field('address', '1 Bypass Road')
    .attach('image', imageFixture);

  it('files the complaint with a fresh code when the first code collides', async () => {
    await createComplaintFixture({ referenceCode: 'CCIR-TAKEN001' });
    vi.spyOn(referenceService, 'generate').mockReturnValueOnce('CCIR-TAKEN001').mockReturnValueOnce('CCIR-FRESH001');
    const response = await file();
    expect(response.status).toBe(201);
    expect(response.body.complaint.referenceCode).toBe('CCIR-FRESH001');
    expect(await Complaint.countDocuments({ referenceCode: 'CCIR-FRESH001' })).toBe(1);
  });

  it('returns a logged server error and removes uploaded photos when every code collides', async () => {
    await createComplaintFixture({ referenceCode: 'CCIR-TAKEN002' });
    vi.spyOn(referenceService, 'generate').mockReturnValue('CCIR-TAKEN002');
    vi.spyOn(uploadService, 'uploadComplaintImage').mockResolvedValue({ url: 'https://example.test/one', publicId: 'photo-one' });
    const cloudDelete = vi.spyOn(uploadService, 'deleteComplaintImages').mockResolvedValue([]);

    const response = await fileWithPhoto();

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({ code: 'INTERNAL_ERROR', requestId: response.headers['x-request-id'] });
    expect(cloudDelete).toHaveBeenCalledWith(['photo-one']);
    expect(referenceService.generate).toHaveBeenCalledTimes(5);
    expect(await Complaint.countDocuments()).toBe(1);
  });

  it('gives 50 simultaneous submissions 50 distinct codes', async () => {
    const responses = await Promise.all(Array.from({ length: 50 }, () => file()));
    expect(responses.map((r) => r.status)).toEqual(Array(50).fill(201));
    expect(new Set(responses.map((r) => r.body.complaint.referenceCode)).size).toBe(50);
  });
});
