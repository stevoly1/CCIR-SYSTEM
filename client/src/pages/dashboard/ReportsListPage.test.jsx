import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import ReportsListPage from './ReportsListPage';
import { fetchComplaints } from '../../slices/complaintSlice';

let state;
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../slices/complaintSlice', () => ({ fetchComplaints: vi.fn((params) => ({ type: 'fetch', params })) }));
vi.mock('../../slices/categorySlice', () => ({ fetchCategories: vi.fn(() => ({ type: 'fetchCategories' })) }));
vi.mock('../../api/axiosClient', () => ({
    default: { get: vi.fn(async () => ({ data: { users: [{ userId: 'a1', displayName: 'Ade Agency' }] } })) },
}));

const renderAs = (role, { url = '/dashboard/reports', pagination = { total: 0 } } = {}) => {
    state = {
        auth: { user: { _id: 'me-1', role } },
        complaints: { items: [], listStatus: 'succeeded', pagination },
        categories: { items: [{ _id: 'k1', name: 'Roads' }, { _id: 'k2', name: 'Drainage' }] },
    };
    return render(<MemoryRouter initialEntries={[url]}><ReportsListPage /></MemoryRouter>);
};

describe('ReportsListPage filters', () => {
    beforeEach(() => { dispatch.mockReset(); vi.mocked(fetchComplaints).mockClear(); });

    it('labels the search box', () => {
        renderAs('citizen');
        expect(screen.getByRole('textbox', { name: 'Search reports' })).toBeInTheDocument();
    });

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

describe('ReportsListPage triage filters', () => {
    beforeEach(() => { dispatch.mockReset(); vi.mocked(fetchComplaints).mockClear(); });

    it.each([
        ['Filter by priority', 'HIGH', { priority: 'HIGH' }],
        ['Filter by category', 'k2', { category: 'k2' }],
        ['Sort order', 'oldest', { sort: 'oldest' }],
    ])('passes %s to the server, from the first page', async (label, value, expected) => {
        const user = userEvent.setup();
        renderAs('citizen', { url: '/dashboard/reports?page=2', pagination: { page: 2, pages: 3, total: 120 } });
        await user.selectOptions(screen.getByRole('combobox', { name: label }), value);
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ ...expected, page: 1 })));
    });

    it('lets administrators list one agent\'s reports or the unassigned ones', async () => {
        const user = userEvent.setup();
        renderAs('admin');
        const assignee = screen.getByRole('combobox', { name: 'Filter by assignee' });
        await screen.findByRole('option', { name: 'Ade Agency' });
        await user.selectOptions(assignee, 'none');
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ assignedTo: 'none' })));
        await user.selectOptions(assignee, 'a1');
        await waitFor(() => expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ assignedTo: 'a1' })));
    });

    it('names an assignee from the address who is no longer assignable, instead of showing "Anyone"', async () => {
        renderAs('admin', { url: '/dashboard/reports?assignee=gone-1' });
        // Before the list arrives nothing is called "no longer assignable".
        expect(screen.getByRole('combobox', { name: 'Filter by assignee' })).toHaveValue('gone-1');
        expect(screen.queryByRole('option', { name: /no longer assignable/i })).not.toBeInTheDocument();
        await screen.findByRole('option', { name: 'Ade Agency' });
        const picker = screen.getByRole('combobox', { name: 'Filter by assignee' });
        expect(picker).toHaveValue('gone-1');
        expect(within(picker).getByRole('option', { selected: true })).toHaveTextContent(/no longer assignable/i);
        expect(fetchComplaints).toHaveBeenLastCalledWith(expect.objectContaining({ assignedTo: 'gone-1' }));
    });

    it('gives citizens and agency staff no assignee picker', () => {
        renderAs('citizen');
        expect(screen.queryByRole('combobox', { name: 'Filter by assignee' })).not.toBeInTheDocument();
    });
});
