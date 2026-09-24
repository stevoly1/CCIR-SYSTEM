const cloudinary = require('../../config/cloudinary');
const uploadService = require('../../services/uploadService');

describe('cloud image upload', () => {
  it('uploads into the complaints folder as an image and returns only the URL and public ID', async () => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload').mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/ccir/complaints/abc.jpg',
      public_id: 'ccir/complaints/abc',
      url: 'http://insecure.example.test/abc.jpg',
      bytes: 1234,
    });

    await expect(uploadService.uploadComplaintImage('/tmp/sanitised.jpg')).resolves.toEqual({
      url: 'https://res.cloudinary.com/demo/image/upload/v1/ccir/complaints/abc.jpg',
      publicId: 'ccir/complaints/abc',
    });
    expect(upload).toHaveBeenCalledWith('/tmp/sanitised.jpg', { folder: 'ccir/complaints', resource_type: 'image' });
  });

  it('passes an upload failure to the caller, which compensates', async () => {
    vi.spyOn(cloudinary.uploader, 'upload').mockRejectedValue(new Error('cloud down'));
    await expect(uploadService.uploadComplaintImage('/tmp/x.jpg')).rejects.toThrow('cloud down');
  });
});
