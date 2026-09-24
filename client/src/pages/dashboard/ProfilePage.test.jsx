import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import ProfilePage from './ProfilePage';

const state = { auth: { user: { name: 'Ada Lovelace', email: 'ada@example.test', role: 'citizen', phone: '' } } };
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../slices/authSlice', () => {
  const updateProfile = Object.assign((args) => ({ type: 'updateProfile', args }), { fulfilled: { match: (a) => a.type === 'updateProfile/fulfilled' } });
  return { updateProfile };
});

describe('ProfilePage', () => {
  beforeEach(() => { dispatch.mockReset(); });

  it('shows the email and role read-only, with accessible labels', () => {
    render(<ProfilePage />);
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.test');
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Role')).toHaveValue('citizen');
    expect(screen.getByLabelText('Role')).toBeDisabled();
  });

  it('sends only the edited name and phone, and confirms the update', async () => {
    dispatch.mockResolvedValue({ type: 'updateProfile/fulfilled' });
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.clear(screen.getByLabelText('Full name'));
    await user.type(screen.getByLabelText('Full name'), 'Ada King');
    await user.type(screen.getByLabelText('Phone'), '+2348000000000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'updateProfile', args: { name: 'Ada King', phone: '+2348000000000' } });
    expect(toast.success).toHaveBeenCalledWith('Profile updated');
  });

  it('shows the server\'s reason when the update is refused', async () => {
    dispatch.mockResolvedValue({ type: 'updateProfile/rejected', payload: 'Name must be at least 2 characters long' });
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(toast.error).toHaveBeenCalledWith('Name must be at least 2 characters long');
  });

  it('falls back to a generic message when the server gives none', async () => {
    dispatch.mockResolvedValue({ type: 'updateProfile/rejected' });
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(toast.error).toHaveBeenCalledWith('Failed to update profile');
  });
});
