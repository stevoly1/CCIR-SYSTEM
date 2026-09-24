import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import ReportsListPage from './ReportsListPage';
import { fetchComplaints } from '../../slices/complaintSlice';

let state;
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../slices/complaintSlice', () => ({ fetchComplaints: vi.fn((params) => ({ type: 'fetch', params })) }));

const renderAs = (role, { url = '/dashboard/reports', pagination = { total: 0 } } = {}) => {
    state = {
        auth: { user: { _id: 'me-1', role } },
        complaints: { items: [], listStatus: 'succeeded', pagination },
    };
    return render(<MemoryRouter initialEntries={[url]}><ReportsListPage /></MemoryRouter>);
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

describe('ReportsListPage paging', () => {
    beforeEach(() => { dispatch.mockReset(); vi.mocked(fetchComplaints).mockClear(); });

    it('requests the page named in the address', async () => {
        renderAs('admin', { url: '/dashboard/reports?page=2', pagination: { page: 2, pages: 3, total: 120 } });
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    });

    it('offers the next page when the results span several pages', async () => {
        const user = userEvent.setup();
        renderAs('admin', { pagination: { page: 1, pages: 3, total: 120 } });
        expect(screen.getByRole('navigation', { name: 'Report pages' })).toHaveTextContent('Page 1 of 3');
        await user.click(screen.getByRole('button', { name: 'Next page' }));
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    });

    it('returns to the first page when the filter changes', async () => {
        const user = userEvent.setup();
        renderAs('admin', { url: '/dashboard/reports?page=3', pagination: { page: 3, pages: 3, total: 120 } });
        await user.click(screen.getByRole('button', { name: 'Resolved' }));
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RESOLVED', page: 1 })));
    });
});
