import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDeleteDialog from './AdminDeleteDialog';

const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../slices/complaintSlice', () => ({
    RELOAD_CODES: ['STALE_COMPLAINT', 'COMPLAINT_NOT_EDITABLE'],
    deleteComplaint: Object.assign((args) => ({ type: 'delete', args }), { fulfilled: { match: (a) => a.type === 'delete/fulfilled' } }),
}));

const complaint = { _id: 'c1', version: 4 };

const submit = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Reason (required)'), '  Spam  ');
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
};

describe('AdminDeleteDialog', () => {
    beforeEach(() => { dispatch.mockReset(); });

    it('sends the trimmed reason with the expected version', async () => {
        dispatch.mockResolvedValue({ type: 'delete/fulfilled', payload: 'c1' });
        const onDeleted = vi.fn();
        render(<AdminDeleteDialog complaint={complaint} onClose={vi.fn()} onDeleted={onDeleted} onConflict={vi.fn()} />);
        await submit();
        expect(dispatch).toHaveBeenCalledWith({ type: 'delete', args: { id: 'c1', reason: 'Spam', expectedVersion: 4 } });
        expect(onDeleted).toHaveBeenCalled();
    });

    it('reloads the report when it changed since it was opened', async () => {
        dispatch.mockResolvedValue({ type: 'delete/rejected', payload: { code: 'STALE_COMPLAINT', message: 'changed' } });
        const onConflict = vi.fn();
        const onDeleted = vi.fn();
        render(<AdminDeleteDialog complaint={complaint} onClose={vi.fn()} onDeleted={onDeleted} onConflict={onConflict} />);
        await submit();
        expect(onConflict).toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it('keeps the dialog open with the reason on any other failure', async () => {
        dispatch.mockResolvedValue({ type: 'delete/rejected', payload: { code: 'INTERNAL', message: 'boom' } });
        const onConflict = vi.fn();
        render(<AdminDeleteDialog complaint={complaint} onClose={vi.fn()} onDeleted={vi.fn()} onConflict={onConflict} />);
        await submit();
        expect(onConflict).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Reason (required)')).toHaveValue('  Spam  ');
    });
});
