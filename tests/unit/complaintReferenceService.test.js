const referenceService = require('../../services/complaintReferenceService');

const collision = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { referenceCode: 1 } });

describe('createWithUniqueReference', () => {
  it('retries only the create with a new code after a reference collision', async () => {
    vi.spyOn(referenceService, 'generate').mockReturnValueOnce('CCIR-AAAAAAAA').mockReturnValueOnce('CCIR-BBBBBBBB');
    const create = vi.fn().mockRejectedValueOnce(collision()).mockImplementationOnce(async (code) => ({ code }));
    await expect(referenceService.createWithUniqueReference(create)).resolves.toEqual({ code: 'CCIR-BBBBBBBB' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([code]) => code)).toEqual(['CCIR-AAAAAAAA', 'CCIR-BBBBBBBB']);
  });

  it('gives up after five collisions with a server error', async () => {
    const create = vi.fn().mockRejectedValue(collision());
    await expect(referenceService.createWithUniqueReference(create)).rejects.toThrow('Could not allocate a unique complaint reference code');
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('recognises a collision reported through keyValue only', async () => {
    const byValue = Object.assign(new Error('E11000'), { code: 11000, keyValue: { referenceCode: 'CCIR-X' } });
    const create = vi.fn().mockRejectedValueOnce(byValue).mockResolvedValueOnce('ok');
    await expect(referenceService.createWithUniqueReference(create)).resolves.toBe('ok');
  });

  it('does not retry any other duplicate key, or any other error', async () => {
    for (const other of [
      Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } }),
      new Error('network down'),
    ]) {
      const create = vi.fn().mockRejectedValue(other);
      await expect(referenceService.createWithUniqueReference(create)).rejects.toBe(other);
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it('produces codes in the documented CCIR-XXXXXXXX shape', () => {
    expect(referenceService.generate()).toMatch(/^CCIR-[0-9A-F]{8}$/);
  });
});
