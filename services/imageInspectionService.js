const fs = require('fs/promises');
const { PayloadTooLargeError, UnsupportedMediaTypeError } = require('../errors');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;
const MIME_BY_FORMAT = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const detectSignature = (header) => {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'jpeg';
  }
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (
    header.length >= 12
    && header.subarray(0, 4).toString('ascii') === 'RIFF'
    && header.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
};

const readHeader = async (tempFilePath) => {
  const handle = await fs.open(tempFilePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const inspectComplaintImage = async (file) => {
  if (
    !file
    || typeof file !== 'object'
    || typeof file.tempFilePath !== 'string'
    || file.tempFilePath.length === 0
    || typeof file.mimetype !== 'string'
    || !Number.isSafeInteger(file.size)
    || file.size < 0
  ) {
    throw new UnsupportedMediaTypeError('Malformed image upload');
  }

  let stat;
  let header;
  try {
    stat = await fs.stat(file.tempFilePath);
    if (!stat.isFile()) throw new Error('Upload path is not a file');
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeError('Image exceeds the 10 MiB limit');
    }
    if (file.size !== stat.size) throw new Error('Declared image size does not match stored upload');
    header = await readHeader(file.tempFilePath);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new UnsupportedMediaTypeError('Malformed image upload');
  }

  const signatureFormat = detectSignature(header);
  if (!signatureFormat || MIME_BY_FORMAT[signatureFormat] !== file.mimetype) {
    throw new UnsupportedMediaTypeError('Image type does not match its content');
  }

  try {
    // Keep the native decoder out of the ordinary application-startup path.
    // Upload inspection is the only boundary that needs to initialize Sharp.
    const sharp = require('sharp');
    const image = sharp(file.tempFilePath, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (metadata.format !== signatureFormat || MIME_BY_FORMAT[metadata.format] !== file.mimetype) {
      throw new UnsupportedMediaTypeError('Decoded image type does not match its content');
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      throw new PayloadTooLargeError('Image exceeds the 25,000,000 pixel limit');
    }
    if ((metadata.pages || 1) > 1) {
      throw new UnsupportedMediaTypeError('Animated images are not supported');
    }

    await image.clone().raw().toBuffer({ resolveWithObject: true });
    return {
      tempFilePath: file.tempFilePath,
      format: metadata.format,
      mimeType: MIME_BY_FORMAT[metadata.format],
      width: metadata.width,
      height: metadata.height,
      size: stat.size,
    };
  } catch (error) {
    if (error instanceof PayloadTooLargeError || error instanceof UnsupportedMediaTypeError) throw error;
    if (/pixel limit|exceeds.*pixels/i.test(error.message)) {
      throw new PayloadTooLargeError('Image exceeds the 25,000,000 pixel limit');
    }
    throw new UnsupportedMediaTypeError('Image could not be fully decoded');
  }
};

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_INPUT_PIXELS,
  inspectComplaintImage,
};
