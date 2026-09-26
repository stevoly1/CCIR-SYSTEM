import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import ChangeEmailForm from './ChangeEmailForm';

const state = { auth: { user: { email: 'ada@example.test', pendingEmailChange: null } } };
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../slices/authSlice', () => ({ fetchProfile: () => ({ type: 'auth/fetchProfile' }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

describe('ChangeEmailForm', () => {
  beforeEach(() => {
    axiosClient.post.mockReset();
    toast.error.mockReset();
    dispatch.mockReset();
    state.auth.user = { email: 'ada@example.test', pendingEmailChange: null };
  });

  const submit = async (user) => {
    await user.type(screen.getByLabelText('New email address'), 'ada.new@example.test');
    await user.type(screen.getByLabelText('Your password'), 'Old-pass-1');
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));
  };

  it('sends exactly newEmail and currentPassword, then shows the answer\'s progress and refreshes', async () => {
    axiosClient.post.mockResolvedValue({ data: { pendingEmailChange: { newEmail: 'ada.new@example.test', state: 'NOTICE_PENDING' } } });
    const user = userEvent.setup();
    render(<ChangeEmailForm />);
    await submit(user);
    expect(axiosClient.post).toHaveBeenCalledWith('/users/profile/email', { newEmail: 'ada.new@example.test', currentPassword: 'Old-pass-1' });
    expect(await screen.findByRole('status')).toHaveTextContent('Sending: first a notice to your current address, then a confirmation link to ada.new@example.test.');
    expect(dispatch).toHaveBeenCalledWith({ type: 'auth/fetchProfile' });
  });

  it('shows the new request\'s progress, not an older failed change the profile still holds', async () => {
    state.auth.user.pendingEmailChange = { newEmail: 'ada.new@example.test', state: 'FAILED' };
    axiosClient.post.mockResolvedValue({ data: { pendingEmailChange: { newEmail: 'ada.new@example.test', state: 'NOTICE_PENDING' } } });
    const user = userEvent.setup();
    render(<ChangeEmailForm />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await submit(user);
    expect(await screen.findByRole('status')).toHaveTextContent('Sending: first a notice');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['LINK_SENT', 'status', 'Check your new inbox at ada.new@example.test. Your address changes when you open the link; it expires in 24 hours.'],
    ['FAILED', 'alert', "We couldn't send the email for the change to ada.new@example.test. Try again."],
  ])('shows the profile\'s %s change', (changeState, role, text) => {
    state.auth.user.pendingEmailChange = { newEmail: 'ada.new@example.test', state: changeState };
    render(<ChangeEmailForm />);
    expect(screen.getByRole(role)).toHaveTextContent(text);
  });

  it('checks progress every 3 seconds while sending, and stops after a minute', async () => {
    vi.useFakeTimers();
    try {
      state.auth.user.pendingEmailChange = { newEmail: 'ada.new@example.test', state: 'NOTICE_SENT' };
      render(<ChangeEmailForm />);
      await vi.advanceTimersByTimeAsync(3000);
      expect(dispatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120000);
      expect(dispatch).toHaveBeenCalledTimes(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll once the link is sent', async () => {
    vi.useFakeTimers();
    try {
      state.auth.user.pendingEmailChange = { newEmail: 'ada.new@example.test', state: 'LINK_SENT' };
      render(<ChangeEmailForm />);
      await vi.advanceTimersByTimeAsync(30000);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows why the request was refused', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'CONFLICT', message: 'An account with this email already exists' } } } });
    const user = userEvent.setup();
    render(<ChangeEmailForm />);
    await submit(user);
    expect(toast.error).toHaveBeenCalledWith('An account with this email already exists');
  });
});
