import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

export const fetchCategories = createAsyncThunk('categories/fetchAll', async (_, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.get('/categories');
        return data.categories;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
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
