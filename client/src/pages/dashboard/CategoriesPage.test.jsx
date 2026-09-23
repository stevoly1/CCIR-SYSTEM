import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CategoriesPage from './CategoriesPage';

const state = {
    categories: {
        status: 'succeeded',
        items: [
            { _id: 'o', name: 'Other', description: '', defaultPriority: 'LOW', isActive: true, complaintCount: 3 },
            { _id: 'r', name: 'Roads', description: 'Road faults', defaultPriority: 'HIGH', isActive: true, complaintCount: 2 },
            // Lean documents saved without a description carry no `description` key.
            { _id: 'm', name: 'Markets', defaultPriority: 'LOW', isActive: false, complaintCount: 0 },
            { _id: 'p', name: 'Parks', description: '', defaultPriority: 'LOW', isActive: false, complaintCount: 1 },
        ],
    },
};
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../slices/categorySlice', () => {
    const thunk = (type) => Object.assign((args) => ({ type, args }), { fulfilled: { match: (a) => a.type === `${type}/fulfilled` } });
    return { fetchCategories: thunk('fetch'), createCategory: thunk('create'), updateCategory: thunk('update'), deleteCategory: thunk('delete') };
});

describe('CategoriesPage', () => {
    // Braces matter: a function returned from beforeEach runs as teardown, which would call dispatch().
    beforeEach(() => { dispatch.mockReset().mockResolvedValue({ type: 'fetch/fulfilled' }); });

    it('protects Other and offers delete only for inactive unused categories', () => {
        render(<CategoriesPage />);
        const other = screen.getByRole('row', { name: /Other/ });
        expect(within(other).getByText(/System fallback/)).toBeInTheDocument();
        expect(within(other).queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Markets' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete Parks' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete Roads' })).not.toBeInTheDocument();
    });

    it('shows a duplicate name inline on the name field', async () => {
        dispatch.mockImplementation(async (action) => (action.type === 'create'
            ? { type: 'create/rejected', payload: { code: 'CATEGORY_NAME_CONFLICT', message: 'A category with this name already exists' } }
            : { type: 'fetch/fulfilled' }));
        const user = userEvent.setup();
        render(<CategoriesPage />);
        await user.type(screen.getByLabelText('Name'), 'roads');
        await user.click(screen.getByRole('button', { name: 'Add category' }));
        await waitFor(() => expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('A category with this name already exists'));
    });

    it('confirms before deactivating', async () => {
        const user = userEvent.setup();
        render(<CategoriesPage />);
        await user.click(screen.getByRole('button', { name: 'Deactivate Roads' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
        await user.click(screen.getByRole('button', { name: 'Confirm deactivate' }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', args: { id: 'r', isActive: false } }));
    });

    it('closes the confirmation at submission so a second click cannot resend', async () => {
        dispatch.mockImplementation((action) => (action.type === 'update' ? new Promise(() => {}) : Promise.resolve({ type: 'fetch/fulfilled' })));
        const user = userEvent.setup();
        render(<CategoriesPage />);
        await user.click(screen.getByRole('button', { name: 'Deactivate Roads' }));
        await user.click(screen.getByRole('button', { name: 'Confirm deactivate' }));
        expect(screen.queryByRole('button', { name: 'Confirm deactivate' })).not.toBeInTheDocument();
        expect(dispatch.mock.calls.filter(([action]) => action.type === 'update')).toHaveLength(1);
    });

    it('disables Add category while a create is in flight', async () => {
        dispatch.mockImplementation((action) => (action.type === 'create' ? new Promise(() => {}) : Promise.resolve({ type: 'fetch/fulfilled' })));
        const user = userEvent.setup();
        render(<CategoriesPage />);
        await user.type(screen.getByLabelText('Name'), 'Markets two');
        await user.click(screen.getByRole('button', { name: 'Add category' }));
        expect(screen.getByRole('button', { name: 'Add category' })).toBeDisabled();
    });

    it('shows a failed row action on its row and clears it when the next action starts', async () => {
        dispatch.mockImplementation(async (action) => (action.type === 'delete'
            ? { type: 'delete/rejected', payload: { code: 'CATEGORY_IN_USE', message: 'Category is still in use' } }
            : { type: `${action.type}/fulfilled` }));
        const user = userEvent.setup();
        render(<CategoriesPage />);
        await user.click(screen.getByRole('button', { name: 'Delete Markets' }));
        await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
        const markets = screen.getByRole('row', { name: 'Markets' });
        expect(await within(markets).findByRole('alert')).toHaveTextContent('Category is still in use');
        await user.click(screen.getByRole('button', { name: 'Activate Markets' }));
        await user.click(screen.getByRole('button', { name: 'Confirm activate' }));
        await waitFor(() => expect(within(markets).queryByRole('alert')).not.toBeInTheDocument());
    });

    it('edits a category that has no stored description without React control warnings', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const user = userEvent.setup();
        render(<CategoriesPage />);
        await user.click(screen.getByRole('button', { name: 'Edit Markets' }));
        const description = screen.getAllByLabelText('Description').at(-1);
        expect(description).toHaveValue('');
        await user.type(description, 'Open-air markets');
        expect(description).toHaveValue('Open-air markets');
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
