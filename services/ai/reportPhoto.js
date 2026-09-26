const cloudinary = require('../../config/cloudinary');
const { JobError } = require('../jobs/jobError');
const { getLogger } = require('../../utils/logger');

const MAX_BYTES = 5 * 1024 * 1024;
const PUBLIC_ID = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

// The worker constructs a rendition URL from the configured cloud and plain public id only.
// A tampered stored URL is never fetched. Missing or unusable photos become text-only input.
const readFirstPhoto = async (complaint, { fetchImpl = fetch, cloudName = cloudinary.config().cloud_name, timeoutMs = 10000 } = {}) => {
  const publicId = complaint.images?.[0]?.publicId;
  if (!publicId || !cloudName || publicId.length > 200 || !PUBLIC_ID.test(publicId)) return null;
  const url = cloudinary.url(publicId, {
    cloud_name: cloudName,
    secure: true,
    resource_type: 'image',
    type: 'upload',
    format: 'jpg',
    transformation: [{ width: 1024, height: 1024, crop: 'limit' }],
  });
  const skip = (reason) => {
    getLogger().info({ event: 'photo_unavailable', complaintId: String(complaint._id), reason }, 'Classifying without the photo');
    return null;
  };
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch {
    throw JobError.of('PROVIDER_DOWN');
  }
  if (response.status === 404) return skip('NOT_FOUND');
  if (!response.ok) throw JobError.of('PROVIDER_DOWN');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return skip('TOO_LARGE');
  let data;
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) {
            await reader.cancel().catch(() => {});
            return skip('TOO_LARGE');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      data = Buffer.concat(chunks, bytes);
    } else {
      data = Buffer.from(await response.arrayBuffer());
    }
  } catch {
    throw JobError.of('PROVIDER_DOWN');
  }
  if (data.length > MAX_BYTES) return skip('TOO_LARGE');
  return { mimeType: 'image/jpeg', data };
};

module.exports = { readFirstPhoto };
