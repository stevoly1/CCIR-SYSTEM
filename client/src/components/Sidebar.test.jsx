import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Sidebar from './Sidebar';

const state = { auth: { user: null } };
vi.mock('react-redux', () => ({ useDispatch: () => vi.fn(), useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const renderAs = (role) => {
    state.auth.user = { _id: 'u1', name: 'Test User', role };
    return render(<MemoryRouter><Sidebar open onClose={vi.fn()} /></MemoryRouter>);
};

describe('Sidebar', () => {
    it('links administrators to category administration', () => {
        renderAs('admin');
        expect(screen.getByRole('link', { name: /Categories/ })).toHaveAttribute('href', '/dashboard/categories');
    });

    it.each(['agency', 'citizen'])('shows no category administration link to %s users', (role) => {
        renderAs(role);
        expect(screen.queryByRole('link', { name: /Categories/ })).not.toBeInTheDocument();
    });
});
