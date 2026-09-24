import axios from 'axios';

const axiosClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1',
    withCredentials: true,
});

// A validation error's own message is generic ("Request validation failed"); the reasons
// that tell the user what to change are in its details, one per field.
const detailMessages = (details) => {
    if (!Array.isArray(details)) return '';
    const messages = details
        .map((detail) => detail?.message)
        .filter((message) => typeof message === 'string' && message.trim());
    return [...new Set(messages)].join('. ');
};

export const extractErrorMessage = (error) => {
    return detailMessages(error?.response?.data?.error?.details)
        || error?.response?.data?.error?.message
        || error?.response?.data?.msg
        || error?.message
        || 'Something went wrong';
};

export const extractErrorCode = (error) => error?.response?.data?.error?.code;

export default axiosClient;
