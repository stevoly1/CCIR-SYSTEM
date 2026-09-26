import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import UsersPage from './UsersPage';

const admin = { _id: 'u-admin', name: 'Chi Admin', email: 'chi@example.test', role: 'admin', phone: '' };
const citizen = { _id: 'u-cit', name: 'Ada Citizen', email: 'ada@example.test', role: 'citizen', phone: '+234800' };
const state = { auth: { user: admin } };
vi.mock('react-redux', () => ({ useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/Topbar', () => ({ default: ({ subtitle }) => <p>{subtitle}</p> }));
vi.mock('../../api/axiosClient', () => ({
  default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn(), post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

const rowOf = (text) => screen.getByText(text).closest('.user-row');

describe('UsersPage', () => {
  beforeEach(() => {
    axiosClient.get.mockReset().mockResolvedValue({ data: { users: [admin, citizen] } });
    axiosClient.patch.mockReset();
    axiosClient.delete.mockReset();
  });

  it('lists the users the API returns', async () => {
    render(<UsersPage />);
    expect(await screen.findByText('Ada Citizen')).toBeInTheDocument();
    expect(screen.getByText('Chi Admin (you)')).toBeInTheDocument();
    expect(screen.getByText('2 registered accounts')).toBeInTheDocument();
    expect(axiosClient.get).toHaveBeenCalledWith('/users', { params: { page: 1, limit: 50 } });
  });

  it('searches through a labelled box', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.type(screen.getByRole('textbox', { name: 'Search users' }), 'ada');
    await waitFor(() => expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { search: 'ada', page: 1, limit: 50 } }));
  });

  it('edits a user through a dialog with labelled fields and saves name, phone and role', async () => {
    axiosClient.patch.mockResolvedValue({ data: { user: { ...citizen, name: 'Ada Renamed', role: 'agency' } } });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.click(within(rowOf('Ada Citizen')).getByRole('button', { name: 'Edit user' }));
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.test');
    expect(screen.getByLabelText('Email')).toBeDisabled();
    await user.clear(screen.getByLabelText('Full name'));
    await user.type(screen.getByLabelText('Full name'), 'Ada Renamed');
    await user.selectOptions(screen.getByLabelText('Role'), 'agency');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(axiosClient.patch).toHaveBeenCalledWith('/users/u-cit', { name: 'Ada Renamed', phone: '+234800', role: 'agency' });
    expect(await screen.findByText('Ada Renamed')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('User updated');
  });

  it('offers an email change for another user in the edit dialog, but not for one\'s own account', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.click(within(rowOf('Ada Citizen')).getByRole('button', { name: 'Edit user' }));
    expect(screen.getByRole('button', { name: 'Change email' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(within(rowOf('Chi Admin (you)')).getByRole('button', { name: 'Edit user' }));
    expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
    expect(screen.getByText('Change your own address from your profile')).toBeInTheDocument();
  });

  it('locks the role of the signed-in administrator\'s own account', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Chi Admin (you)');
    await user.click(within(rowOf('Chi Admin (you)')).getByRole('button', { name: 'Edit user' }));
    expect(screen.getByLabelText('Role')).toBeDisabled();
  });

  it('deletes a user after confirmation and reloads the page from the server', async () => {
    axiosClient.delete.mockResolvedValue({ data: { msg: 'User retired' } });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    axiosClient.get.mockResolvedValue({ data: { users: [admin] } });
    await user.click(within(rowOf('Ada Citizen')).getByRole('button', { name: 'Delete user' }));
    expect(axiosClient.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(axiosClient.delete).toHaveBeenCalledWith('/users/u-cit');
    await waitFor(() => expect(screen.queryByText('Ada Citizen')).not.toBeInTheDocument());
    expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { page: 1, limit: 50 } });
  });

  it('counts every account and pages through them', async () => {
    axiosClient.get.mockResolvedValue({ data: { users: [admin, citizen], pagination: { page: 1, limit: 50, total: 73, pages: 2 } } });
    const user = userEvent.setup();
    render(<UsersPage />);
    expect(await screen.findByText('73 registered accounts')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'User pages' })).toHaveTextContent('Page 1 of 2');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { page: 2, limit: 50 } }));
  });

  it('searches from the first page', async () => {
    axiosClient.get.mockResolvedValue({ data: { users: [admin, citizen], pagination: { page: 1, limit: 50, total: 73, pages: 2 } } });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { page: 2, limit: 50 } }));
    await user.type(screen.getByRole('textbox', { name: 'Search users' }), 'ada');
    await waitFor(() => expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { search: 'ada', page: 1, limit: 50 } }));
  });

  it('never offers deletion of the signed-in administrator\'s own account', async () => {
    render(<UsersPage />);
    await screen.findByText('Chi Admin (you)');
    const ownDelete = within(rowOf('Chi Admin (you)')).getByRole('button', { name: 'Delete user' });
    expect(ownDelete).toBeDisabled();
    expect(ownDelete).toHaveAttribute('title', "You can't delete your own account here");
  });

  it('shows the server\'s reason when an edit is refused', async () => {
    axiosClient.patch.mockRejectedValue({ response: { data: { error: { message: 'An account with this email already exists' } } } });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.click(within(rowOf('Ada Citizen')).getByRole('button', { name: 'Edit user' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(toast.error).toHaveBeenCalledWith('An account with this email already exists');
  });

  describe('account controls', () => {
    const suspended = { _id: 'u-sus', name: 'Sam Suspended', email: 'sam@example.test', role: 'citizen', isActive: false };
    const retired = { _id: 'u-ret', name: 'Retired account', email: 'retired+u-ret@invalid.local', role: 'citizen', isActive: false, retiredAt: '2026-09-01T00:00:00.000Z' };
    const withUsers = (...users) => axiosClient.get.mockResolvedValue({ data: { users, pagination: { page: 1, pages: 1, total: users.length } } });

    it('filters by role from the first page', async () => {
      const user = userEvent.setup();
      render(<UsersPage />);
      await screen.findByText('Ada Citizen');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by role' }), 'agency');
      await waitFor(() => expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { role: 'agency', page: 1, limit: 50 } }));
    });

    it('marks suspended and retired accounts', async () => {
      withUsers(admin, suspended, retired);
      render(<UsersPage />);
      expect(await within(await rowFor('Sam Suspended')).findByText('Suspended')).toBeInTheDocument();
      expect(within(rowOf('Retired account')).getByText('Retired')).toBeInTheDocument();
      expect(within(rowOf('Chi Admin (you)')).queryByText(/Suspended|Retired/)).not.toBeInTheDocument();
    });

    it('shows when, and why, an account was suspended', async () => {
      withUsers(admin, { ...suspended, suspendedAt: '2026-09-20T10:00:00.000Z', suspensionReason: 'Repeated abusive reports' }, { ...suspended, _id: 'u-sus2', name: 'Old Suspension' });
      render(<UsersPage />);
      const row = await rowFor('Sam Suspended');
      expect(within(row).getByText(/Suspended on .+ — Repeated abusive reports/)).toBeInTheDocument();
      // Accounts suspended before the date was recorded show only the badge.
      expect(within(rowOf('Old Suspension')).queryByText(/Suspended on/)).not.toBeInTheDocument();
    });

    it('keeps the role filter when it is changed while a search is waiting to run', async () => {
      const user = userEvent.setup();
      render(<UsersPage />);
      await screen.findByText('Ada Citizen');
      await user.type(screen.getByLabelText(/search/i), 'ad');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by role' }), 'agency');
      await new Promise((resolve) => { setTimeout(resolve, 600); });
      expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { search: 'ad', role: 'agency', page: 1, limit: 50 } });
    });

    it('offers no action on a retired account, and no suspension of one\'s own', async () => {
      withUsers(admin, retired);
      render(<UsersPage />);
      const row = await rowFor('Retired account');
      for (const name of ['Edit user', 'Suspend user', 'Delete user']) expect(within(row).getByRole('button', { name })).toBeDisabled();
      expect(within(rowOf('Chi Admin (you)')).getByRole('button', { name: 'Suspend user' })).toBeDisabled();
    });

    it('suspends with a reason after confirmation, then reloads from the server', async () => {
      withUsers(admin, citizen);
      axiosClient.patch.mockResolvedValue({ data: { user: { ...citizen, isActive: false } } });
      const user = userEvent.setup();
      render(<UsersPage />);
      await user.click(within(await rowFor('Ada Citizen')).getByRole('button', { name: 'Suspend user' }));
      expect(axiosClient.patch).not.toHaveBeenCalled();
      await user.type(screen.getByLabelText('Reason (optional)'), 'Abusive reports');
      axiosClient.get.mockClear();
      await user.click(screen.getByRole('button', { name: 'Suspend' }));
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/u-cit', { isActive: false, reason: 'Abusive reports' });
      await waitFor(() => expect(axiosClient.get).toHaveBeenCalled());
      expect(toast.success).toHaveBeenCalledWith('Account suspended');
    });

    it('reactivates a suspended account after confirmation', async () => {
      withUsers(admin, suspended);
      axiosClient.patch.mockResolvedValue({ data: { user: { ...suspended, isActive: true } } });
      const user = userEvent.setup();
      render(<UsersPage />);
      await user.click(within(await rowFor('Sam Suspended')).getByRole('button', { name: 'Reactivate user' }));
      await user.click(screen.getByRole('button', { name: 'Reactivate' }));
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/u-sus', { isActive: true });
    });

    it('sends the reason given when deleting', async () => {
      withUsers(admin, citizen);
      axiosClient.delete.mockResolvedValue({ data: { msg: 'User retired' } });
      const user = userEvent.setup();
      render(<UsersPage />);
      await user.click(within(await rowFor('Ada Citizen')).getByRole('button', { name: 'Delete user' }));
      await user.type(screen.getByLabelText('Reason (optional)'), 'Duplicate account');
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(axiosClient.delete).toHaveBeenCalledWith('/users/u-cit', { data: { reason: 'Duplicate account' } });
    });
  });

  it('marks unverified accounts, and will not give them a staff role', async () => {
    const unverified = { ...citizen, _id: 'u-new', name: 'New Person', emailVerified: false };
    axiosClient.get.mockResolvedValue({ data: { users: [admin, unverified] } });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('New Person');
    expect(within(rowOf('New Person')).getByText('Email not verified')).toBeInTheDocument();
    expect(within(rowOf('Chi Admin (you)')).queryByText('Email not verified')).toBeNull();
    await user.click(within(rowOf('New Person')).getByRole('button', { name: 'Edit user' }));
    const role = screen.getByLabelText('Role');
    expect(within(role).getByRole('option', { name: 'agency' })).toBeDisabled();
    expect(within(role).getByRole('option', { name: 'admin' })).toBeDisabled();
    expect(within(role).getByRole('option', { name: 'citizen' })).not.toBeDisabled();
    expect(screen.getByText("Verify this account's email address before giving it a staff role.")).toBeInTheDocument();
  });
});

async function rowFor(text) {
  return (await screen.findByText(text)).closest('.user-row');
}
