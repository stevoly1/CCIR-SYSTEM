import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosClient, { extractErrorCode, extractErrorMessage } from '../api/axiosClient';

const rejection = (error) => ({ message: extractErrorMessage(error), code: extractErrorCode(error) });

export const fetchCategories = createAsyncThunk('categories/fetchAll', async (_, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.get('/categories');
        return data.categories;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

// Writes resolve with the server's category; the admin page refetches the list afterwards
// so complaint counts stay server-computed.
export const createCategory = createAsyncThunk('categories/create', async (body, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.post('/categories', body);
        return data.category;
    } catch (error) {
        return rejectWithValue(rejection(error));
    }
});

export const updateCategory = createAsyncThunk('categories/update', async ({ id, ...body }, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.patch(`/categories/${id}`, body);
        return data.category;
    } catch (error) {
        return rejectWithValue(rejection(error));
    }
});

export const deleteCategory = createAsyncThunk('categories/delete', async (id, { rejectWithValue }) => {
    try {
        await axiosClient.delete(`/categories/${id}`);
        return id;
    } catch (error) {
        return rejectWithValue(rejection(error));
    }
});

const categorySlice = createSlice({
    name: 'categories',
    initialState: {
        items: [],
        status: 'idle',
        error: null,
    },
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchCategories.pending, (state) => { state.status = 'loading'; })
            .addCase(fetchCategories.fulfilled, (state, action) => { state.status = 'succeeded'; state.items = action.payload; })
            .addCase(fetchCategories.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload; });
    },
});

export default categorySlice.reducer;
