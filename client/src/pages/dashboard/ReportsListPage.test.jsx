import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ReportsListPage from './ReportsListPage';
import { fetchComplaints } from '../../slices/complaintSlice';

let state;
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../slices/complaintSlice', () => ({ fetchComplaints: vi.fn((params) => ({ type: 'fetch', params })) }));

const renderAs = (role) => {
    state = {
        auth: { user: { _id: 'me-1', role } },
        complaints: { items: [], listStatus: 'succeeded', pagination: { total: 0 } },
    };
    return render(<MemoryRouter><ReportsListPage /></MemoryRouter>);
};

describe('ReportsListPage filters', () => {
    beforeEach(() => { dispatch.mockReset(); vi.mocked(fetchComplaints).mockClear(); });

    it('offers a Withdrawn filter', () => {
        renderAs('citizen');
        expect(screen.getByRole('button', { name: 'Withdrawn' })).toBeInTheDocument();
    });

    it('does not offer citizens an assignee filter', () => {
        renderAs('citizen');
        expect(screen.queryByRole('button', { name: 'Assigned to me' })).not.toBeInTheDocument();
    });

    it('lets agency staff narrow the list to their own assignments', async () => {
        const user = userEvent.setup();
        renderAs('agency');
        await user.click(screen.getByRole('button', { name: 'Assigned to me' }));
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ assignedTo: 'me-1' })));
        expect(screen.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true');
    });
});
