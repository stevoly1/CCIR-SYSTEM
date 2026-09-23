import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axiosClient from '../../api/axiosClient';
import ResponsibilityPanel from './ResponsibilityPanel';

const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../slices/complaintSlice', () => ({
    RELOAD_CODES: ['STALE_COMPLAINT'],
    assignComplaint: Object.assign((args) => ({ type: 'assign', args }), { fulfilled: { match: (a) => a.type === 'assign/fulfilled' } }),
}));

const complaint = { _id: 'c1', version: 7, canAssign: true, assignee: null, assignmentHistory: [] };
const assigned = { ...complaint, assignee: { userId: 'a', displayName: 'Ade Agency', role: 'agency' } };

describe('ResponsibilityPanel', () => {
    beforeEach(() => {
        dispatch.mockReset().mockResolvedValue({ type: 'assign/fulfilled', payload: complaint });
        axiosClient.get.mockReset().mockResolvedValue({ data: { users: [{ userId: 'a', displayName: 'Ade Agency' }, { userId: 'b', displayName: 'Bisi Agency' }] } });
    });

    it('lets an administrator assign with a reason', async () => {
        const user = userEvent.setup();
        render(<ResponsibilityPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('option', { name: 'Bisi Agency' })).toBeInTheDocument());
        await user.selectOptions(screen.getByLabelText('Assign to'), 'b');
        await user.type(screen.getByLabelText('Assignment reason (optional)'), 'Nearest crew');
        await user.click(screen.getByRole('button', { name: 'Assign' }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', assignedTo: 'b', reason: 'Nearest crew', expectedVersion: 7 });
    });

    it('offers only other staff when reassigning', async () => {
        render(<ResponsibilityPanel complaint={assigned} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('option', { name: 'Bisi Agency' })).toBeInTheDocument());
        expect(screen.queryByRole('option', { name: 'Ade Agency' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reassign' })).toBeInTheDocument();
    });

    it('keeps a selection made after the store updates but before the request settles', async () => {
        let settle;
        dispatch.mockReset().mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
        const user = userEvent.setup();
        const { rerender } = render(<ResponsibilityPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('option', { name: 'Ade Agency' })).toBeInTheDocument());
        await user.selectOptions(screen.getByLabelText('Assign to'), 'a');
        await user.click(screen.getByRole('button', { name: 'Assign' }));

        rerender(<ResponsibilityPanel complaint={assigned} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.selectOptions(screen.getByLabelText('Assign to'), 'b');
        settle({ type: 'assign/fulfilled', payload: assigned });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Reassign' })).toBeEnabled());
        expect(screen.getByLabelText('Assign to')).toHaveValue('b');
    });

    it('restores the choice and reason when assignment fails', async () => {
        dispatch.mockReset().mockResolvedValue({ type: 'assign/rejected', payload: { code: 'CONFLICT', message: 'nope' } });
        const user = userEvent.setup();
        render(<ResponsibilityPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('option', { name: 'Bisi Agency' })).toBeInTheDocument());
        await user.selectOptions(screen.getByLabelText('Assign to'), 'b');
        await user.type(screen.getByLabelText('Assignment reason (optional)'), 'Closer crew');
        await user.click(screen.getByRole('button', { name: 'Assign' }));
        await waitFor(() => expect(screen.getByLabelText('Assign to')).toHaveValue('b'));
        expect(screen.getByLabelText('Assignment reason (optional)')).toHaveValue('Closer crew');
    });

    it('survives the store clearing the assignee before an unassign settles', async () => {
        let settle;
        dispatch.mockReset().mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
        const user = userEvent.setup();
        const { rerender } = render(<ResponsibilityPanel complaint={assigned} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Unassign' }));
        await user.click(screen.getByRole('button', { name: 'Confirm unassign' }));

        expect(() => rerender(<ResponsibilityPanel complaint={{ ...complaint, version: 8 }} onUpdated={vi.fn()} onConflict={vi.fn()} />)).not.toThrow();
        settle({ type: 'assign/fulfilled', payload: complaint });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm unassign' })).not.toBeInTheDocument());
        expect(screen.getByText('Not assigned')).toBeInTheDocument();
    });

    it('is read-only for agency users', () => {
        render(<ResponsibilityPanel complaint={{ ...assigned, canAssign: false }} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.getByText('Ade Agency')).toBeInTheDocument();
        expect(screen.queryByLabelText('Assign to')).not.toBeInTheDocument();
        expect(axiosClient.get).not.toHaveBeenCalled();
    });

    it('confirms before unassigning', async () => {
        const user = userEvent.setup();
        render(<ResponsibilityPanel complaint={assigned} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Unassign' }));
        expect(dispatch).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Confirm unassign' }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', assignedTo: null, expectedVersion: 7 });
    });

    it('shows the assignment history', () => {
        render(<ResponsibilityPanel complaint={{ ...assigned, canAssign: false, assignmentHistory: [
            { type: 'ASSIGNED', next: { displayName: 'Ade Agency' }, changedBy: { displayName: 'Chi Admin' }, reason: 'Nearest crew', createdAt: '2026-09-02T10:00:00Z' },
        ] }} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.getByLabelText('Assignment history')).toHaveTextContent('Assigned to Ade Agency by Chi Admin — Nearest crew');
    });
});
