import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import axiosClient from '../../api/axiosClient';
import ConfirmEmailPage from './ConfirmEmailPage';

const state = { auth: { user: null } };
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../slices/authSlice', () => ({ fetchProfile: () => ({ type: 'fetchProfile' }) }));
vi.mock('../../layouts/AuthLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
  extractErrorCode: (error) => error?.response?.data?.error?.code,
}));

const TOKEN = 'b'.repeat(43);
const renderAt = (hash) => {
  window.history.replaceState(null, '', `/confirm-email${hash}`);
  return render(<MemoryRouter><ConfirmEmailPage /></MemoryRouter>);
};

describe('ConfirmEmailPage', () => {
  beforeEach(() => { axiosClient.post.mockReset(); dispatch.mockReset(); state.auth.user = null; });

  it('confirms only when asked (no automatic call), then says so', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    expect(window.location.hash).toBe('');
    expect(axiosClient.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm new email address' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/auth/email/confirm', { token: TOKEN });
    expect(await screen.findByText('Your email address has been changed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('refreshes the profile of a signed-in user', async () => {
    state.auth.user = { email: 'old@example.test' };
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Confirm new email address' }));
    expect(await screen.findByRole('link', { name: 'Back to your profile' })).toHaveAttribute('href', '/dashboard/profile');
    expect(dispatch).toHaveBeenCalledWith({ type: 'fetchProfile' });
  });

  it('explains an expired link and a taken address', async () => {
    const user = userEvent.setup();
    axiosClient.post.mockRejectedValueOnce({ response: { data: { error: { code: 'INVALID_OR_EXPIRED_TOKEN', message: 'x' } } } });
    renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Confirm new email address' }));
    expect(await screen.findByText('This link is invalid or has expired. Ask for the change again from your profile.')).toBeInTheDocument();
  });

  it('shows other errors in words', async () => {
    const user = userEvent.setup();
    axiosClient.post.mockRejectedValueOnce({ response: { data: { error: { code: 'CONFLICT', message: 'An account with this email already exists' } } } });
    renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Confirm new email address' }));
    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
  });
});
