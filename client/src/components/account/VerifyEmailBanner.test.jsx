import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axiosClient from '../../api/axiosClient';
import VerifyEmailBanner from './VerifyEmailBanner';

const state = { auth: { user: null } };
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../slices/authSlice', () => ({ fetchProfile: () => ({ type: 'auth/fetchProfile' }) }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
  extractErrorCode: (error) => error?.response?.data?.error?.code,
}));

describe('VerifyEmailBanner', () => {
  beforeEach(() => {
    axiosClient.post.mockReset();
    dispatch.mockReset();
    state.auth.user = { email: 'ada@example.test', emailVerified: false };
  });

  it('shows nothing for a verified account, or before the account is known', () => {
    state.auth.user = { email: 'ada@example.test', emailVerified: true };
    const { container, rerender } = render(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
    state.auth.user = null;
    rerender(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells an unverified account why, and sends a new link', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<VerifyEmailBanner />);
    expect(screen.getByText(/Verify your email/)).toHaveTextContent('Verify your email to report issues. We sent a link to ada@example.test.');
    expect(screen.getByRole('region', { name: 'Email verification' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resend link' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/users/profile/verification-email');
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a new link to ada@example.test.');
  });

  it('refreshes the account when it turns out to be verified already', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'ALREADY_VERIFIED', message: 'x' } } } });
    const user = userEvent.setup();
    render(<VerifyEmailBanner />);
    await user.click(screen.getByRole('button', { name: 'Resend link' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'auth/fetchProfile' });
  });

  it('says why a link could not be sent', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later' } } } });
    const user = userEvent.setup();
    render(<VerifyEmailBanner />);
    await user.click(screen.getByRole('button', { name: 'Resend link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests; try again later');
  });

  it('uses the panel form where the page itself waits for verification', () => {
    render(<VerifyEmailBanner variant="panel" />);
    expect(screen.getByRole('region', { name: 'Email verification' })).toHaveClass('verify-panel');
  });
});
