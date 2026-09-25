import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import DeleteAccountSection from './DeleteAccountSection';
import { leaveTo } from '../../routes/leavePage';

vi.mock('../../routes/leavePage', () => ({ leaveTo: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({
  default: { delete: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

const renderFor = (account) => render(<DeleteAccountSection user={account} />);

describe('DeleteAccountSection', () => {
  beforeEach(() => { axiosClient.delete.mockReset(); leaveTo.mockReset(); });

  it('asks a password account for its password and an optional reason', async () => {
    axiosClient.delete.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderFor({ email: 'ada@example.test', role: 'citizen', authProvider: 'local' });
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.type(screen.getByLabelText('Password'), 'Old-pass-1');
    await user.type(screen.getByLabelText('Reason (optional)'), 'Moving away');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(axiosClient.delete).toHaveBeenCalledWith('/users/profile', { data: { password: 'Old-pass-1', reason: 'Moving away' } });
    // A full page load: the app restarts signed out, holding nothing from the deleted account.
    expect(leaveTo).toHaveBeenCalledWith('/account-deleted');
  });

  it('asks a Google account to type its email, and sends no empty reason', async () => {
    axiosClient.delete.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderFor({ email: 'g@example.test', role: 'citizen', authProvider: 'google' });
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.type(screen.getByLabelText('Type your email address to confirm'), 'g@example.test');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(axiosClient.delete).toHaveBeenCalledWith('/users/profile', { data: { confirmEmail: 'g@example.test' } });
  });

  it('keeps the dialog open and shows why on failure', async () => {
    axiosClient.delete.mockRejectedValue({ response: { data: { error: { message: 'The current password is incorrect' } } } });
    const user = userEvent.setup();
    renderFor({ email: 'ada@example.test', role: 'citizen', authProvider: 'local' });
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(toast.error).toHaveBeenCalledWith('The current password is incorrect');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(leaveTo).not.toHaveBeenCalled();
  });

  it('tells a citizen their name leaves their reports, and staff that theirs stays in the handling history', () => {
    const { unmount } = renderFor({ email: 'ada@example.test', role: 'citizen', authProvider: 'local' });
    expect(screen.getByText(/Reports you filed stay with the agencies, without your name/)).toBeInTheDocument();
    unmount();
    renderFor({ email: 'sam@example.test', role: 'agency', authProvider: 'local' });
    expect(screen.getByText(/Your name stays in the history of the reports you handled/)).toBeInTheDocument();
    expect(screen.queryByText(/without your name/)).toBeNull();
  });

  it('tells administrators another administrator must retire them', () => {
    renderFor({ email: 'chi@example.test', role: 'admin', authProvider: 'local' });
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
    expect(screen.getByText(/Another administrator can retire it/)).toBeInTheDocument();
  });
});
