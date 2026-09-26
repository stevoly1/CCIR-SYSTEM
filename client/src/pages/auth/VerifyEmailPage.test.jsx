import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import axiosClient from '../../api/axiosClient';
import VerifyEmailPage from './VerifyEmailPage';

const state = { auth: { user: null } };
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../slices/authSlice', () => ({ fetchProfile: () => ({ type: 'fetchProfile' }) }));
vi.mock('../../layouts/AuthLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../components/account/VerifyEmailBanner', () => ({ default: () => <p>banner stub</p> }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
  extractErrorCode: (error) => error?.response?.data?.error?.code,
}));

const TOKEN = 'c'.repeat(43);
const renderAt = (hash) => {
  window.history.replaceState(null, '', `/verify-email${hash}`);
  return render(<MemoryRouter><VerifyEmailPage /></MemoryRouter>);
};
const expired = { response: { data: { error: { code: 'INVALID_OR_EXPIRED_TOKEN', message: 'x' } } } };

describe('VerifyEmailPage', () => {
  beforeEach(() => { axiosClient.post.mockReset(); dispatch.mockReset(); state.auth.user = null; });

  it('verifies only when asked (no automatic call), then says so', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('heading', { name: 'Verify your email address' })).toBeInTheDocument();
    expect(axiosClient.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Verify my email address' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/auth/email/verify', { token: TOKEN });
    expect(await screen.findByRole('status')).toHaveTextContent('Your email address is verified. You can now report issues.');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refreshes the profile of a signed-in user', async () => {
    state.auth.user = { email: 'ada@example.test', emailVerified: false };
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Verify my email address' }));
    expect(await screen.findByRole('link', { name: 'Report an issue' })).toHaveAttribute('href', '/dashboard/report');
    expect(dispatch).toHaveBeenCalledWith({ type: 'fetchProfile' });
  });

  it('offers a new link after an expired one: signed in, the banner; signed out, sign-in', async () => {
    state.auth.user = { email: 'ada@example.test', emailVerified: false };
    axiosClient.post.mockRejectedValue(expired);
    const user = userEvent.setup();
    const { unmount } = renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Verify my email address' }));
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByText('banner stub')).toBeInTheDocument();
    unmount();

    state.auth.user = null;
    renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Verify my email address' }));
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to send a new link' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('banner stub')).toBeNull();
  });

  it('shows other errors in words', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later' } } } });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Verify my email address' }));
    expect(await screen.findByText('Too many requests; try again later')).toBeInTheDocument();
  });

  it('says when the link is incomplete', () => {
    renderAt('');
    expect(screen.getByText('This link is incomplete.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
