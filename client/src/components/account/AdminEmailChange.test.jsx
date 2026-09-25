import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import AdminEmailChange from './AdminEmailChange';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

const citizen = { _id: 'u-cit', email: 'typo@exmaple.test', authProvider: 'local' };

describe('AdminEmailChange', () => {
  beforeEach(() => { axiosClient.post.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

  it('sends exactly newEmail to the user\'s email endpoint', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<AdminEmailChange user={citizen} isSelf={false} />);
    await user.click(screen.getByRole('button', { name: 'Change email' }));
    await user.type(screen.getByLabelText('New email address'), 'right@example.test');
    await user.click(screen.getByRole('button', { name: 'Send confirmation' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/users/u-cit/email', { newEmail: 'right@example.test' });
    expect(toast.success).toHaveBeenCalledWith('Confirmation sent to right@example.test. The address changes when the user confirms it.');
  });

  it('shows the server reason', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { message: 'An account with this email already exists' } } } });
    const user = userEvent.setup();
    render(<AdminEmailChange user={citizen} isSelf={false} />);
    await user.click(screen.getByRole('button', { name: 'Change email' }));
    await user.type(screen.getByLabelText('New email address'), 'taken@example.test');
    await user.click(screen.getByRole('button', { name: 'Send confirmation' }));
    expect(toast.error).toHaveBeenCalledWith('An account with this email already exists');
  });

  it('sends on Enter without submitting the edit form around it', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const onSubmit = vi.fn((e) => e.preventDefault());
    const user = userEvent.setup();
    render(<form onSubmit={onSubmit}><AdminEmailChange user={citizen} isSelf={false} /></form>);
    await user.click(screen.getByRole('button', { name: 'Change email' }));
    await user.type(screen.getByLabelText('New email address'), 'right@example.test{Enter}');
    expect(axiosClient.post).toHaveBeenCalledWith('/users/u-cit/email', { newEmail: 'right@example.test' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is not offered for a Google account or the administrator\'s own account', () => {
    const { rerender } = render(<AdminEmailChange user={{ ...citizen, authProvider: 'google' }} isSelf={false} />);
    expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
    expect(screen.getByText('Managed by Google')).toBeInTheDocument();
    rerender(<AdminEmailChange user={citizen} isSelf />);
    expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
    expect(screen.getByText('Change your own address from your profile')).toBeInTheDocument();
  });
});
