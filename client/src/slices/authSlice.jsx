import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

export const signup = createAsyncThunk('auth/signup', async (payload, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.post('/auth/signup', payload);
        return data.user;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const login = createAsyncThunk('auth/login', async (payload, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.post('/auth/login', payload);
        return data.user;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const fetchProfile = createAsyncThunk('auth/fetchProfile', async (_, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.get('/users/profile');
        return data.user;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const updateProfile = createAsyncThunk('auth/updateProfile', async (payload, { rejectWithValue }) => {
    try {
        const { data } = await axiosClient.patch('/users/profile', payload);
        return data.user;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

export const logout = createAsyncThunk('auth/logout', async (_, { rejectWithValue }) => {
    try {
        await axiosClient.post('/users/logout');
        return true;
    } catch (error) {
        return rejectWithValue(extractErrorMessage(error));
    }
});

const authSlice = createSlice({
    name: 'auth',
    initialState: {
        user: null,
        authChecked: false,
        status: 'idle',
        error: null,
    },
    reducers: {
        clearAuthError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(signup.pending, (state) => { state.status = 'loading'; state.error = null; })
            .addCase(signup.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.authChecked = true; })
            .addCase(signup.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload; })

            .addCase(login.pending, (state) => { state.status = 'loading'; state.error = null; })
            .addCase(login.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.authChecked = true; })
            .addCase(login.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload; })

            .addCase(fetchProfile.pending, (state) => { state.status = 'loading'; })
            .addCase(fetchProfile.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.authChecked = true; })
            .addCase(fetchProfile.rejected, (state) => { state.status = 'idle'; state.user = null; state.authChecked = true; })

            .addCase(updateProfile.fulfilled, (state, action) => { state.user = action.payload; })

            .addCase(logout.fulfilled, (state) => { state.user = null; })
            .addCase(logout.rejected, (state) => { state.user = null; });
    },
});

export const { clearAuthError } = authSlice.actions;
export default authSlice.reducer;
