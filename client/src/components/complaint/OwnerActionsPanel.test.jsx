import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OwnerActionsPanel from './OwnerActionsPanel';

const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../LocationField', () => ({
    default: ({ id, value, onChange }) => (
        <>
            <label htmlFor={id}>Location</label>
            <input id={id} value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
        </>
    ),
}));
vi.mock('../../slices/complaintSlice', () => ({
    RELOAD_CODES: ['STALE_COMPLAINT', 'COMPLAINT_NOT_EDITABLE'],
    editComplaint: Object.assign((args) => ({ type: 'edit', args }), {
        fulfilled: { match: (action) => action.type === 'edit/fulfilled' },
    }),
    withdrawComplaint: Object.assign((args) => ({ type: 'withdraw', args }), {
        fulfilled: { match: (action) => action.type === 'withdraw/fulfilled' },
    }),
}));

const complaint = { _id: 'c1', version: 4, description: 'Old text about a pothole', address: 'Bus stop', canEdit: true, canWithdraw: true };

describe('OwnerActionsPanel', () => {
    beforeEach(() => dispatch.mockReset());

    it('hides actions the server does not allow', () => {
        render(<OwnerActionsPanel complaint={{ ...complaint, canEdit: false, canWithdraw: false }} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /edit report/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /withdraw report/i })).not.toBeInTheDocument();
    });

    it('sends only changed fields with the loaded version and reports re-analysis', async () => {
        dispatch.mockResolvedValue({ type: 'edit/fulfilled', payload: { complaint: { ...complaint, version: 5 }, reanalysed: true } });
        const onUpdated = vi.fn();
        const user = userEvent.setup();
        render(<OwnerActionsPanel complaint={complaint} onUpdated={onUpdated} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /edit report/i }));
        const description = screen.getByLabelText('Description');
        await user.clear(description);
        await user.type(description, 'New text about a blocked drain');
        await user.click(screen.getByRole('button', { name: /save changes/i }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', description: 'New text about a blocked drain', expectedVersion: 4 });
        await waitFor(() => expect(screen.getByText('Your report was re-analysed')).toBeInTheDocument());
        expect(onUpdated).toHaveBeenCalled();
    });

    it('sends the replaced location when only the location changes', async () => {
        dispatch.mockResolvedValue({ type: 'edit/fulfilled', payload: { complaint, reanalysed: false } });
        const user = userEvent.setup();
        render(<OwnerActionsPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /edit report/i }));
        await user.type(screen.getByLabelText('Location'), ' east');
        await user.click(screen.getByRole('button', { name: /save changes/i }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', location: { address: 'Bus stop east' }, expectedVersion: 4 });
        await waitFor(() => expect(screen.getByText('Report updated')).toBeInTheDocument());
    });

    it('keeps its notice across a refresh and reopens the form from the latest server data', async () => {
        dispatch.mockResolvedValue({ type: 'edit/fulfilled', payload: { complaint, reanalysed: true } });
        const user = userEvent.setup();
        const { rerender } = render(<OwnerActionsPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /edit report/i }));
        await user.type(screen.getByLabelText('Description'), ' more');
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        const refreshed = { ...complaint, version: 6, description: 'Server-side text after refresh', address: 'Refreshed address' };
        rerender(<OwnerActionsPanel complaint={refreshed} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(await screen.findByText('Your report was re-analysed')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /edit report/i }));
        expect(screen.getByLabelText('Description')).toHaveValue('Server-side text after refresh');
        expect(screen.getByLabelText('Location')).toHaveValue('Refreshed address');
    });

    it('reloads on a conflict', async () => {
        dispatch.mockResolvedValue({ type: 'edit/rejected', payload: { code: 'STALE_COMPLAINT', message: 'changed' } });
        const onConflict = vi.fn();
        const user = userEvent.setup();
        render(<OwnerActionsPanel complaint={complaint} onUpdated={vi.fn()} onConflict={onConflict} />);
        await user.click(screen.getByRole('button', { name: /edit report/i }));
        await user.type(screen.getByLabelText('Location'), ' east');
        await user.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => expect(onConflict).toHaveBeenCalled());
    });

    it('withdraws with an optional reason', async () => {
        dispatch.mockResolvedValue({ type: 'withdraw/fulfilled', payload: { ...complaint, status: 'WITHDRAWN' } });
        const user = userEvent.setup();
        render(<OwnerActionsPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /withdraw report/i }));
        await user.type(screen.getByLabelText(/reason/i), 'Already fixed');
        await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', reason: 'Already fixed', expectedVersion: 4 });
    });

    it('withdraws without a reason when none is given', async () => {
        dispatch.mockResolvedValue({ type: 'withdraw/fulfilled', payload: { ...complaint, status: 'WITHDRAWN' } });
        const user = userEvent.setup();
        render(<OwnerActionsPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: /withdraw report/i }));
        await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
        expect(dispatch.mock.calls[0][0].args).toEqual({ id: 'c1', expectedVersion: 4 });
    });
});
