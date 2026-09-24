import { render, screen } from '@testing-library/react';
import ComplaintSummary from './ComplaintSummary';

const base = {
    description: 'Pothole', category: { name: 'Roads', recordedName: 'Roads' }, address: 'Bus stop',
    hasPrecisePosition: true, images: [], ai: { summary: 'AI text', tags: [] },
};

describe('ComplaintSummary', () => {
    it('shows staff the coordinates to five decimal places with their source', () => {
        render(<ComplaintSummary staffView complaint={{ ...base, location: { address: 'Bus stop', latitude: 6.601812345, longitude: 3.351498765, coordinateSource: 'DEVICE' } }} />);
        expect(screen.getByText("Coordinates: 6.60181, 3.35150 (from the reporter's device)")).toBeInTheDocument();
    });

    it('names a suggested address as the coordinate source in words', () => {
        render(<ComplaintSummary staffView complaint={{ ...base, location: { address: 'Bus stop', latitude: 6.6, longitude: 3.35, coordinateSource: 'SUGGESTION' } }} />);
        expect(screen.getByText('Coordinates: 6.60000, 3.35000 (from an address suggestion)')).toBeInTheDocument();
    });

    it('shows the owner only the address and a precise-position flag', () => {
        render(<ComplaintSummary staffView={false} complaint={base} />);
        expect(screen.getByText('Precise position recorded')).toBeInTheDocument();
        expect(screen.queryByText(/Coordinates:/)).not.toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/\d+\.\d{3,}/);
    });

    it('says when no address was recorded', () => {
        render(<ComplaintSummary staffView={false} complaint={{ ...base, address: null, hasPrecisePosition: false }} />);
        expect(screen.getByText('No address recorded')).toBeInTheDocument();
    });

    it('titles each read-only section with a heading, not a form label', () => {
        const { container } = render(<ComplaintSummary staffView={false} complaint={base} />);
        expect(container.querySelector('label')).toBeNull();
        for (const name of ['Description', 'Category', 'Location', 'AI summary']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
    });
});
