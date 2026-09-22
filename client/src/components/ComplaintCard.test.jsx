import { render, screen } from '@testing-library/react';
import ComplaintCard from './ComplaintCard';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

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
});
