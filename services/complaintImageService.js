const fs = require('fs/promises');
const { PayloadTooLargeError } = require('../errors');
const imageInspectionService = require('./imageInspectionService');
const uploadService = require('./uploadService');

const MAX_IMAGES = 5;
const MAX_AGGREGATE_BYTES = 25 * 1024 * 1024;

const normalizeFiles = (rawFiles) => (
  Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []
);

const prepareComplaintImages = async (rawFiles) => {
  const files = normalizeFiles(rawFiles);
  if (files.length > MAX_IMAGES) {
    throw new PayloadTooLargeError('A complaint can include at most 5 images');
  }

  const hasNumericSizes = files.every((file) => Number.isSafeInteger(file?.size) && file.size >= 0);
  if (hasNumericSizes) {
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_AGGREGATE_BYTES) {
      throw new PayloadTooLargeError('Complaint images exceed the 25 MiB aggregate limit');
    }
  }

  const inspected = [];
  try {
    for (const file of files) {
      inspected.push(await imageInspectionService.inspectComplaintImage(file));
    }
    const canonicalBytes = inspected.reduce((sum, file) => sum + file.size, 0);
    if (canonicalBytes > MAX_AGGREGATE_BYTES) {
      throw new PayloadTooLargeError('Canonical complaint images exceed the 25 MiB aggregate limit');
    }
  } catch (error) {
    await cleanupTemporaryFiles(inspected);
    throw error;
  }
  return inspected;
};

const cleanupCloudImages = async (images = []) => {
  const publicIds = images.map((image) => image?.publicId).filter(Boolean);
  if (publicIds.length === 0) return [];

  let failedPublicIds;
  try {
    failedPublicIds = await uploadService.deleteComplaintImages(publicIds);
  } catch {
    failedPublicIds = publicIds;
  }
  if (failedPublicIds.length > 0) {
    console.error('Cloud image cleanup failed:', failedPublicIds);
  }
  return failedPublicIds;
};

const uploadComplaintImages = async (files) => {
  const uploaded = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadService.uploadComplaintImage(file.tempFilePath));
    }
    return uploaded;
  } catch (error) {
    await cleanupCloudImages(uploaded);
    throw error;
  }
};

const cleanupTemporaryFiles = async (files = []) => {
  const paths = [...new Set(files
    .map((file) => file?.tempFilePath)
    .filter((tempFilePath) => typeof tempFilePath === 'string' && tempFilePath.length > 0))];
  await Promise.allSettled(paths.map((tempFilePath) => fs.unlink(tempFilePath)));
};

module.exports = {
  MAX_AGGREGATE_BYTES,
  MAX_IMAGES,
  cleanupCloudImages,
  cleanupTemporaryFiles,
  prepareComplaintImages,
  uploadComplaintImages,
};
