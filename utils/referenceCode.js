const crypto = require('crypto');

// e.g. CCIR-7F3K9Q2A
const generateReferenceCode = () => {
    const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    return `CCIR-${random}`;
};

module.exports = generateReferenceCode;
