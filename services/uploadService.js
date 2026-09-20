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
    const filteredIds = publicIds.filter(Boolean);
    const results = await Promise.allSettled(filteredIds.map(deleteComplaintImage));
    return filteredIds.filter((_, index) => results[index].status === 'rejected');
};

module.exports = { uploadComplaintImage, deleteComplaintImage, deleteComplaintImages };
