import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

export const fetchComplaints = createAsyncThunk('complaints/fetchAll', async (params = {}, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.get('/complaints', { params });
        return data;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const fetchComplaint = createAsyncThunk('complaints/fetchOne', async (id, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.get(`/complaints/${id}`);
        return data.complaint;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const createComplaint = createAsyncThunk('complaints/create', async (formData, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.post('/complaints', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data.complaint;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const updateComplaintStatus = createAsyncThunk(
    'complaints/updateStatus',
    async ({ id, ...payload }, { rejectWithValue }) => {
        try {
            const { data } = await axiosClient.patch(`/complaints/${id}/status`, payload);
            return data.complaint;
        } catch (error) {
            return rejectWithValue(extractErrorMessage(error));
        }
    }
);

export const assignComplaint = createAsyncThunk(
    'complaints/assign',
    async ({ id, assignedTo }, { rejectWithValue }) => {
        try {
            const { data } = await axiosClient.patch(`/complaints/${id}/assign`, { assignedTo });
            return data.complaint;
        } catch (error) {
            return rejectWithValue(extractErrorMessage(error));
        }
    }
);

export const deleteComplaint = createAsyncThunk('complaints/delete', async (id, { rejectWithValue }) => {
    try {
        await axiosClient.delete(`/complaints/${id}`);
        return id;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

const complaintSlice = createSlice({
    name: 'complaints',
    initialState: {
        items: [],
        pagination: { page: 1, limit: 20, total: 0, pages: 1 },
        current: null,
        listStatus: 'idle',
        detailStatus: 'idle',
        createStatus: 'idle',
        error: null,
    },
    reducers: {
        clearComplaintError: (state) => { state.error = null; },
        clearCurrentComplaint: (state) => { state.current = null; },
        resetCreateStatus: (state) => { state.createStatus = 'idle'; },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchComplaints.pending, (state) => { state.listStatus = 'loading'; })
            .addCase(fetchComplaints.fulfilled, (state, action) => {
                state.listStatus = 'succeeded';
                state.items = action.payload.complaints;
                state.pagination = action.payload.pagination;
            })
            .addCase(fetchComplaints.rejected, (state, action) => { state.listStatus = 'failed'; state.error = action.payload; })

            .addCase(fetchComplaint.pending, (state) => { state.detailStatus = 'loading'; })
            .addCase(fetchComplaint.fulfilled, (state, action) => { state.detailStatus = 'succeeded'; state.current = action.payload; })
            .addCase(fetchComplaint.rejected, (state, action) => { state.detailStatus = 'failed'; state.error = action.payload; })

            .addCase(createComplaint.pending, (state) => { state.createStatus = 'loading'; state.error = null; })
            .addCase(createComplaint.fulfilled, (state, action) => {
                state.createStatus = 'succeeded';
                state.items = [action.payload, ...state.items];
            })
            .addCase(createComplaint.rejected, (state, action) => { state.createStatus = 'failed'; state.error = action.payload; })

            .addCase(updateComplaintStatus.fulfilled, (state, action) => {
                state.current = action.payload;
                state.items = state.items.map((c) => (c._id === action.payload._id ? action.payload : c));
            })
            .addCase(assignComplaint.fulfilled, (state, action) => {
                state.current = action.payload;
                state.items = state.items.map((c) => (c._id === action.payload._id ? action.payload : c));
            })
            .addCase(deleteComplaint.fulfilled, (state, action) => {
                state.items = state.items.filter((c) => c._id !== action.payload);
            });
    },
});

export const { clearComplaintError, clearCurrentComplaint, resetCreateStatus } = complaintSlice.actions;
export default complaintSlice.reducer;
