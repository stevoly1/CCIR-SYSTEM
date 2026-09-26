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

const citizen = { _id: 'u-cit', email: 'typo@exmaple.test', authProvider: 'local', pendingEmailChange: null };
const accepted = { data: { pendingEmailChange: { newEmail: 'right@example.test', state: 'NOTICE_PENDING' } } };

describe('AdminEmailChange', () => {
  beforeEach(() => { axiosClient.post.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

  const open = async (user) => user.click(screen.getByRole('button', { name: 'Change email' }));

  it('focuses the address, sends exactly newEmail, then shows and focuses the progress', async () => {
    axiosClient.post.mockResolvedValue(accepted);
    const user = userEvent.setup();
    render(<AdminEmailChange user={citizen} isSelf={false} />);
    await open(user);
    expect(screen.getByLabelText('New email address')).toHaveFocus();
    await user.type(screen.getByLabelText('New email address'), 'right@example.test');
    await user.click(screen.getByRole('button', { name: 'Send confirmation' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/users/u-cit/email', { newEmail: 'right@example.test' });
    const progress = await screen.findByRole('status');
    expect(progress).toHaveTextContent("Sending: first a notice to the user's current address, then a confirmation link to right@example.test.");
    expect(progress).toHaveFocus();
    expect(screen.queryByLabelText('New email address')).toBeNull();
  });

  it('shows the user\'s change in progress', () => {
    render(<AdminEmailChange user={{ ...citizen, pendingEmailChange: { newEmail: 'right@example.test', state: 'LINK_SENT' } }} isSelf={false} />);
    expect(screen.getByRole('status')).toHaveTextContent("Check the user's new inbox at right@example.test. The address changes when the user opens the link; it expires in 24 hours.");
  });

  it('shows the server reason inside the dialog, not as a toast', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { message: 'An account with this email already exists' } } } });
    const user = userEvent.setup();
    render(<AdminEmailChange user={citizen} isSelf={false} />);
    await open(user);
    await user.type(screen.getByLabelText('New email address'), 'taken@example.test');
    await user.click(screen.getByRole('button', { name: 'Send confirmation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email already exists');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('cancels, returning focus to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<AdminEmailChange user={citizen} isSelf={false} />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('New email address')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change email' })).toHaveFocus();
  });

  it('sends on Enter without submitting the edit form around it', async () => {
    axiosClient.post.mockResolvedValue(accepted);
    const onSubmit = vi.fn((e) => e.preventDefault());
    const user = userEvent.setup();
    render(<form onSubmit={onSubmit}><AdminEmailChange user={citizen} isSelf={false} /></form>);
    await open(user);
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
