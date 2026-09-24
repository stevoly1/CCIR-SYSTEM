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
  default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
    expect(axiosClient.get).toHaveBeenCalledWith('/users', { params: {} });
  });

  it('searches through a labelled box', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.type(screen.getByRole('textbox', { name: 'Search users' }), 'ada');
    await waitFor(() => expect(axiosClient.get).toHaveBeenLastCalledWith('/users', { params: { search: 'ada' } }));
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

  it('locks the role of the signed-in administrator\'s own account', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Chi Admin (you)');
    await user.click(within(rowOf('Chi Admin (you)')).getByRole('button', { name: 'Edit user' }));
    expect(screen.getByLabelText('Role')).toBeDisabled();
  });

  it('deletes a user after confirmation', async () => {
    axiosClient.delete.mockResolvedValue({ data: { msg: 'User retired' } });
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText('Ada Citizen');
    await user.click(within(rowOf('Ada Citizen')).getByRole('button', { name: 'Delete user' }));
    expect(axiosClient.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(axiosClient.delete).toHaveBeenCalledWith('/users/u-cit');
    await waitFor(() => expect(screen.queryByText('Ada Citizen')).not.toBeInTheDocument());
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
});
