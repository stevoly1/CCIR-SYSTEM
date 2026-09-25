import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import ChangePasswordForm from './ChangePasswordForm';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

const fill = async (user, current, next, repeat = next) => {
  await user.type(screen.getByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password'), next);
  await user.type(screen.getByLabelText('Repeat new password'), repeat);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
};

describe('ChangePasswordForm', () => {
  beforeEach(() => { axiosClient.post.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

  it('sends exactly currentPassword and newPassword, then clears the form', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await fill(user, 'Old-pass-1', 'Brand-new-pass');
    expect(axiosClient.post).toHaveBeenCalledWith('/users/profile/password', { currentPassword: 'Old-pass-1', newPassword: 'Brand-new-pass' });
    expect(toast.success).toHaveBeenCalledWith('Password changed. Your other devices have been signed out.');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('refuses mismatched new passwords without calling the API', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await fill(user, 'Old-pass-1', 'Brand-new-pass', 'Other-new-pass');
    expect(toast.error).toHaveBeenCalledWith('The new passwords do not match');
    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  it('shows the server reason', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { message: 'The current password is incorrect' } } } });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await fill(user, 'wrong-pass', 'Brand-new-pass');
    expect(toast.error).toHaveBeenCalledWith('The current password is incorrect');
  });

  it('asks for 8 characters', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByLabelText('New password')).toHaveAttribute('minLength', '8');
  });
});
