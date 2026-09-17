const cloudinary = require('../config/cloudinary');

const uploadComplaintImage = async (tempFilePath) => {
    const result = await cloudinary.uploader.upload(tempFilePath, {
        folder: 'ccir/complaints',
        resource_type: 'image',
    });

    return { url: result.secure_url, publicId: result.public_id };
};

const deleteComplaintImage = async (publicId) => {
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId);
};

const deleteComplaintImages = async (publicIds = []) => {
    await Promise.all(publicIds.filter(Boolean).map(deleteComplaintImage));
};

module.exports = { uploadComplaintImage, deleteComplaintImage, deleteComplaintImages };
