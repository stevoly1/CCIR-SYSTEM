import axios from 'axios';

const axiosClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1',
    withCredentials: true,
});

export const extractErrorMessage = (error) => {
    return error?.response?.data?.msg || error?.message || 'Something went wrong';
};

export default axiosClient;
