import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pager from './Pager';

describe('Pager', () => {
    it('renders nothing when everything fits on one page', () => {
        const { container } = render(<Pager page={1} pages={1} onChange={vi.fn()} label="Reports pages" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('moves between pages and stops at either end', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<Pager page={1} pages={3} onChange={onChange} label="Reports pages" />);
        expect(screen.getByRole('navigation', { name: 'Reports pages' })).toHaveTextContent('Page 1 of 3');
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Next page' }));
        expect(onChange).toHaveBeenLastCalledWith(2);

        rerender(<Pager page={3} pages={3} onChange={onChange} label="Reports pages" />);
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Previous page' }));
        expect(onChange).toHaveBeenLastCalledWith(2);
    });
});
