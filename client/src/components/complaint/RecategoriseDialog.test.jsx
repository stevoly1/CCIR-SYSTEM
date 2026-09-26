import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axiosClient from '../../api/axiosClient';
import RecategoriseDialog from './RecategoriseDialog';

vi.mock('../../api/axiosClient', () => ({
    default: { get: vi.fn(), patch: vi.fn() },
    extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
    extractErrorCode: (error) => error?.response?.data?.error?.code,
}));
const complaint = { _id: 'c1', version: 4, category: { _id: 'roads', name: 'Roads' } };

describe('recategorise dialog', () => {
    beforeEach(() => {
        axiosClient.get.mockResolvedValue({ data: { categories: [{ _id: 'roads', name: 'Roads' }, { _id: 'drain', name: 'Drainage' }] } });
        axiosClient.patch.mockReset();
    });

    it('sends category, private reason and version', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        axiosClient.patch.mockResolvedValue({ data: {} });
        render(<RecategoriseDialog complaint={complaint} initialCategoryId="drain" title="Re-categorise" onClose={vi.fn()} onDone={onDone} onConflict={vi.fn()} />);
        expect(await screen.findByLabelText('Category')).toHaveValue('drain');
        const save = screen.getByRole('button', { name: 'Save category' });
        expect(save).toBeDisabled();
        await user.type(screen.getByLabelText('Reason (staff only)'), 'The photo shows a drain');
        await user.click(save);
        expect(axiosClient.patch).toHaveBeenCalledWith('/complaints/c1/category', { categoryId: 'drain', reason: 'The photo shows a drain', expectedVersion: 4 });
        expect(onDone).toHaveBeenCalled();
    });

    it('shows a refusal and hands a stale report back to the page', async () => {
        const user = userEvent.setup();
        const onConflict = vi.fn();
        axiosClient.patch.mockRejectedValueOnce({ response: { data: { error: { code: 'CATEGORY_INACTIVE', message: 'The selected category is not available' } } } })
            .mockRejectedValueOnce({ response: { data: { error: { code: 'STALE_COMPLAINT', message: 'This report changed' } } } });
        render(<RecategoriseDialog complaint={complaint} initialCategoryId="drain" title="Re-categorise" onClose={vi.fn()} onDone={vi.fn()} onConflict={onConflict} />);
        await user.type(await screen.findByLabelText('Reason (staff only)'), 'Because');
        await user.click(screen.getByRole('button', { name: 'Save category' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('The selected category is not available');
        await user.click(screen.getByRole('button', { name: 'Save category' }));
        expect(onConflict).toHaveBeenCalled();
    });

    it('can be cancelled', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<RecategoriseDialog complaint={complaint} initialCategoryId="roads" title="Re-categorise" onClose={onClose} onDone={vi.fn()} onConflict={vi.fn()} />);
        await user.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });
});
