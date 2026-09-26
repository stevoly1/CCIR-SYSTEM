import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import toast from 'react-hot-toast';
import Sidebar from './Sidebar';

const state = { auth: { user: null } };
const dispatch = vi.fn();
const navigate = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-router', async (original) => ({ ...(await original()), useNavigate: () => navigate }));
vi.mock('../slices/authSlice', () => ({ logout: () => ({ type: 'logout' }) }));

const renderAs = (role, onClose = vi.fn()) => {
    state.auth.user = { _id: 'u1', name: 'Test User', role };
    return render(<MemoryRouter><Sidebar open onClose={onClose} /></MemoryRouter>);
};

describe('Sidebar', () => {
    beforeEach(() => { dispatch.mockReset().mockResolvedValue({ type: 'logout/fulfilled' }); navigate.mockReset(); });

    it('links administrators to category administration', () => {
        renderAs('admin');
        expect(screen.getByRole('link', { name: /Categories/ })).toHaveAttribute('href', '/dashboard/categories');
    });

    it.each(['agency', 'citizen'])('shows no category administration link to %s users', (role) => {
        renderAs(role);
        expect(screen.queryByRole('link', { name: /Categories/ })).not.toBeInTheDocument();
    });

    it('links administrators to the Jobs page', () => {
        renderAs('admin');
        expect(screen.getByRole('link', { name: /Jobs/ })).toHaveAttribute('href', '/dashboard/jobs');
    });

    it.each(['agency', 'citizen'])('shows no Jobs link to %s users', (role) => {
        renderAs(role);
        expect(screen.queryByRole('link', { name: /Jobs/ })).not.toBeInTheDocument();
    });

    it('logs out, closes the menu, and returns to the login page', async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();
        renderAs('citizen', onClose);
        await user.click(screen.getByRole('button', { name: 'Log out' }));
        expect(onClose).toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ type: 'logout' });
        expect(toast.success).toHaveBeenCalledWith('Logged out');
        expect(navigate).toHaveBeenCalledWith('/login');
    });
});
