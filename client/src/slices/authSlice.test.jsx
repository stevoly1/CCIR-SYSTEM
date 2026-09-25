import { configureStore } from '@reduxjs/toolkit';
import axiosClient from '../api/axiosClient';
import authReducer, { accountDeleted, fetchProfile } from './authSlice';

vi.mock('../api/axiosClient', () => ({
    default: { get: vi.fn() },
    extractErrorMessage: () => 'failed',
}));

describe('session check', () => {
    it('asks the server once while a check is already under way', async () => {
        let answer;
        axiosClient.get.mockReset().mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        const store = configureStore({ reducer: { auth: authReducer } });

        const first = store.dispatch(fetchProfile());
        store.dispatch(fetchProfile());
        answer({ data: { user: { _id: 'u1' } } });
        await first;

        expect(axiosClient.get).toHaveBeenCalledTimes(1);
        expect(store.getState().auth.user).toEqual({ _id: 'u1' });

        axiosClient.get.mockResolvedValue({ data: { user: { _id: 'u1' } } });
        await store.dispatch(fetchProfile());
        expect(axiosClient.get).toHaveBeenCalledTimes(2);
    });
});

describe('account deletion', () => {
    it('clears the user when the account is deleted', () => {
        const state = authReducer({ user: { email: 'a@example.test' }, authChecked: true, profileCheckPending: false, status: 'idle', error: null }, accountDeleted());
        expect(state.user).toBeNull();
        expect(state.authChecked).toBe(true);
    });
});
