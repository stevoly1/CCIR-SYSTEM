import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StaffActionsPanel from './StaffActionsPanel';

const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../slices/complaintSlice', () => ({
    RELOAD_CODES: ['STALE_COMPLAINT', 'COMPLAINT_NOT_EDITABLE'],
    updateComplaintStatus: Object.assign((args) => ({ type: 'status', args }), { fulfilled: { match: (a) => a.type === 'status/fulfilled' } }),
}));

const base = { _id: 'c1', version: 2, status: 'IN_REVIEW', priority: 'LOW', allowedTransitions: ['PENDING', 'IN_PROGRESS', 'REJECTED'], canChangePriority: true };

describe('StaffActionsPanel', () => {
    beforeEach(() => dispatch.mockReset().mockResolvedValue({ type: 'status/fulfilled', payload: base }));

    it('offers exactly the server-allowed transitions plus no change', () => {
        render(<StaffActionsPanel complaint={base} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        const options = within(screen.getByLabelText('Status')).getAllByRole('option').map((o) => o.value);
        expect(options).toEqual(['', 'PENDING', 'IN_PROGRESS', 'REJECTED']);
    });

    it('names statuses and priorities in words rather than stored codes', () => {
        render(<StaffActionsPanel complaint={base} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        const texts = (label) => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.textContent);
        expect(texts('Status')).toEqual(['No status change', 'Pending', 'In Progress', 'Rejected']);
        expect(texts('Priority')).toEqual(['Low', 'Medium', 'High', 'Critical']);
    });

    it('sends a priority-only update with notes and the version', async () => {
        const user = userEvent.setup();
        render(<StaffActionsPanel complaint={base} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Save update' })).toBeDisabled();
        await user.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
        await user.type(screen.getByLabelText('Internal note (staff only)'), 'School nearby');
        await user.click(screen.getByRole('button', { name: 'Save update' }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', priority: 'HIGH', internalNote: 'School nearby', expectedVersion: 2 });
    });

    it('sends a status change with a public note and without an unchanged priority', async () => {
        const user = userEvent.setup();
        render(<StaffActionsPanel complaint={base} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
        await user.type(screen.getByLabelText('Public note (visible to the reporter)'), 'Crew on site');
        await user.click(screen.getByRole('button', { name: 'Save update' }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', status: 'IN_PROGRESS', publicNote: 'Crew on site', expectedVersion: 2 });
    });

    it('explains when the viewer may not act', () => {
        render(<StaffActionsPanel complaint={{ ...base, allowedTransitions: [], canChangePriority: false }} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.getByText('Only the assigned staff member can update this report.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument();
    });

    it('reloads when the server says the viewer is no longer assigned', async () => {
        dispatch.mockResolvedValue({ type: 'status/rejected', payload: { code: 'NOT_ASSIGNED_TO_YOU', message: 'x' } });
        const onConflict = vi.fn();
        const user = userEvent.setup();
        render(<StaffActionsPanel complaint={base} onUpdated={vi.fn()} onConflict={onConflict} />);
        await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
        await user.click(screen.getByRole('button', { name: 'Save update' }));
        expect(onConflict).toHaveBeenCalled();
    });
});
