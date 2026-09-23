const { Category, Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');

const fallback = (error) => ({
  category: 'Other',
  priority: 'MEDIUM',
  summary: '',
  tags: [],
  confidence: 0,
  error,
});

describe('complaint AI fallback invariant', () => {
  it.each(['TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_ERROR', 'INVALID_OUTPUT'])(
    'persists %s through Other with its configured default',
    async (errorCode) => {
      const { agent, user } = await createAuthenticatedAgent({ role: 'citizen' });
      const other = await createCategoryFixture({ name: 'Other', defaultPriority: 'CRITICAL' });
      const roads = await createCategoryFixture({ name: 'Roads', defaultPriority: 'LOW' });
      vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(fallback(errorCode));

      const response = await unsafeRequest(agent, 'post', '/api/v1/complaints').send({
        description: `A detailed fallback complaint for ${errorCode}`,
        address: '1 Test Street',
        categoryId: roads.id,
      });

      expect(response.status).toBe(201);
      const stored = await Complaint.findOne({ reporter: user._id });
      expect(stored).toMatchObject({
        category: other._id,
        priority: 'CRITICAL',
        ai: {
          suggestedCategory: 'Other',
          confidence: 0,
          summary: '',
          tags: [],
          error: errorCode,
        },
      });
    },
  );

  it('fails safely before AI use when active Other is absent', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    await createCategoryFixture({ name: 'Roads' });
    const classify = vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(fallback('TIMEOUT'));

    const response = await unsafeRequest(agent, 'post', '/api/v1/complaints').send({
      description: 'A detailed complaint with no fallback category configured',
      address: '1 Test Street',
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: response.headers['x-request-id'] },
      msg: 'Something went wrong',
    });
    expect(classify).not.toHaveBeenCalled();
    expect(await Complaint.countDocuments()).toBe(0);
  });

  it('protects Other from rename, deactivation, and deletion while allowing configuration', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const other = await createCategoryFixture({ name: 'Other', defaultPriority: 'MEDIUM' });

    const renamed = await unsafeRequest(agent, 'patch', `/api/v1/categories/${other.id}`)
      .send({ name: 'Miscellaneous' });
    expect(renamed.status).toBe(409);

    const deactivated = await unsafeRequest(agent, 'patch', `/api/v1/categories/${other.id}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(409);

    const configured = await unsafeRequest(agent, 'patch', `/api/v1/categories/${other.id}`).send({
      description: 'Required complaint fallback',
      defaultPriority: 'HIGH',
    });
    expect(configured.status).toBe(200);
    expect(configured.body.category).toMatchObject({ name: 'Other', isActive: true, defaultPriority: 'HIGH' });

    const deleted = await unsafeRequest(agent, 'delete', `/api/v1/categories/${other.id}`);
    expect(deleted.status).toBe(409);
    expect(await Category.findById(other.id)).toMatchObject({ name: 'Other', isActive: true });
  });
});
