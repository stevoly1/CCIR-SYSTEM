import { render, screen } from '@testing-library/react';
import Topbar from './Topbar';

describe('Topbar', () => {
    it('shows the title, subtitle and page actions without a notifications button', () => {
        render(<Topbar title="Reports" subtitle="3 found" actions={<button type="button">Delete permanently</button>} />);
        expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
        expect(screen.getByText('3 found')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();
    });

    it('leaves out the actions area when a page has none', () => {
        const { container } = render(<Topbar title="Profile" />);
        expect(container.querySelector('.topbar-actions')).toBeNull();
    });
});
