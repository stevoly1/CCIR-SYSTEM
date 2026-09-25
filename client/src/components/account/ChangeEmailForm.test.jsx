import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import ChangeEmailForm from './ChangeEmailForm';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

describe('ChangeEmailForm', () => {
  beforeEach(() => { axiosClient.post.mockReset(); toast.error.mockReset(); });

  const submit = async (user) => {
    await user.type(screen.getByLabelText('New email address'), 'ada.new@example.test');
    await user.type(screen.getByLabelText('Your password'), 'Old-pass-1');
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));
  };

  it('sends exactly newEmail and currentPassword, and says where to look', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<ChangeEmailForm />);
    await submit(user);
    expect(axiosClient.post).toHaveBeenCalledWith('/users/profile/email', { newEmail: 'ada.new@example.test', currentPassword: 'Old-pass-1' });
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a confirmation link to ada.new@example.test');
  });

  it('shows why the link could not be sent', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'EMAIL_NOT_SENT', message: 'We could not send the email; please try again' } } } });
    const user = userEvent.setup();
    render(<ChangeEmailForm />);
    await submit(user);
    expect(toast.error).toHaveBeenCalledWith('We could not send the email; please try again');
  });
});
