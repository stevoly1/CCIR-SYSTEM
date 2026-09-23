import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';

const Harness = ({ children }) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
            <button type="button">Behind the dialog</button>
            {open && (
                <Modal title="Edit report" onClose={() => setOpen(false)}>
                    {children}
                </Modal>
            )}
        </>
    );
};

const Fields = () => (
    <>
        <label htmlFor="f-name">Name</label>
        <input id="f-name" />
        <button type="button">Save</button>
    </>
);

describe('Modal', () => {
    it('is a modal dialog named by its title', async () => {
        const user = userEvent.setup();
        render(<Harness><Fields /></Harness>);
        await user.click(screen.getByRole('button', { name: 'Open dialog' }));
        const dialog = screen.getByRole('dialog', { name: 'Edit report' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('moves focus into the dialog body when it opens', async () => {
        const user = userEvent.setup();
        render(<Harness><Fields /></Harness>);
        await user.click(screen.getByRole('button', { name: 'Open dialog' }));
        expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    it('keeps Tab and Shift+Tab inside the dialog', async () => {
        const user = userEvent.setup();
        render(<Harness><Fields /></Harness>);
        await user.click(screen.getByRole('button', { name: 'Open dialog' }));
        await user.tab();
        expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
        await user.tab();
        await user.tab();
        expect(screen.getByLabelText('Name')).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Behind the dialog' })).not.toHaveFocus();
    });

    it('returns focus to the control that opened it when it closes', async () => {
        const user = userEvent.setup();
        render(<Harness><Fields /></Harness>);
        const opener = screen.getByRole('button', { name: 'Open dialog' });
        await user.click(opener);
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });
});

describe('ConfirmModal', () => {
    it('cannot be dismissed with Escape while its action is in flight', async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();
        render(<ConfirmModal title="Unassign report" message="Remove?" confirmLabel="Confirm unassign" loading onConfirm={vi.fn()} onClose={onClose} />);
        await user.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();
    });
});
