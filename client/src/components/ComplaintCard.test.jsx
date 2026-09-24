import { render, screen } from '@testing-library/react';
import ComplaintCard from './ComplaintCard';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

const summary = {
    _id: 'c1', referenceCode: 'CCIR-1', status: 'PENDING', priority: 'HIGH', description: 'Pothole',
    category: { _id: 'k1', name: 'Road damage', recordedName: 'Potholes', isActive: true, deleted: false },
    address: null, hasPrecisePosition: false, imageCount: 0, thumbnailUrl: null, createdAt: new Date().toISOString(),
};

describe('ComplaintCard', () => {
    it('renders the summary contract, including renamed categories and missing addresses', () => {
        render(<ComplaintCard complaint={summary} />);
        expect(screen.getByText("Road damage (filed as 'Potholes')")).toBeInTheDocument();
        expect(screen.getByText('No address recorded')).toBeInTheDocument();
    });

    it('uses the thumbnail URL when present', () => {
        render(<ComplaintCard complaint={{ ...summary, thumbnailUrl: 'https://img.test/1.jpg' }} />);
        expect(document.querySelector('img.complaint-thumb')).toHaveAttribute('src', 'https://img.test/1.jpg');
    });

    // Staff summaries carry `assignee` (null when nobody has the report); reporters' do not.
    it('tells staff who has the report, or that nobody does', () => {
        const { rerender } = render(<ComplaintCard complaint={{ ...summary, assignee: { userId: 'u9', displayName: 'Ade Agency' } }} />);
        expect(screen.getByText('Assigned to Ade Agency')).toBeInTheDocument();
        rerender(<ComplaintCard complaint={{ ...summary, assignee: null }} />);
        expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });

    it('says nothing about assignment on a reporter\'s own summary', () => {
        render(<ComplaintCard complaint={summary} />);
        expect(screen.queryByText(/Assigned to|Unassigned/)).not.toBeInTheDocument();
    });
});
