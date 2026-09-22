import { render, screen } from '@testing-library/react';
import ComplaintTimeline from './ComplaintTimeline';
import { categoryLabel } from './categoryLabel';

const citizenEntries = [
    { _id: '1', type: 'CREATED', status: 'PENDING', publicNote: 'Report submitted', actorLabel: 'You', createdAt: '2026-09-01T10:00:00Z' },
    { _id: '2', type: 'STATUS_CHANGED', status: 'IN_REVIEW', publicNote: 'Checking the site', actorLabel: 'Agency staff', createdAt: '2026-09-02T10:00:00Z' },
];

describe('ComplaintTimeline', () => {
    it('shows citizens role labels and public notes, newest first', () => {
        render(<ComplaintTimeline entries={citizenEntries} staffView={false} />);
        const items = screen.getAllByRole('listitem');
        expect(items[0]).toHaveTextContent('Checking the site');
        expect(items[0]).toHaveTextContent('Agency staff');
        expect(items[1]).toHaveTextContent('You');
        expect(screen.queryByText(/staff only/i)).not.toBeInTheDocument();
    });

    it('never renders an internal note in the citizen view', () => {
        render(<ComplaintTimeline staffView={false} entries={[{ ...citizenEntries[1], internalNote: 'Contractor ref 42' }]} />);
        expect(screen.queryByText('Contractor ref 42')).not.toBeInTheDocument();
    });

    it('shows staff the actor name and a labelled internal note', () => {
        render(<ComplaintTimeline staffView entries={[{
            _id: '3', type: 'STATUS_CHANGED', status: 'IN_PROGRESS', publicNote: 'Crew dispatched',
            internalNote: 'Contractor ref 42', actorLabel: 'Administrator',
            actor: { userId: 'u1', displayName: 'Chi Admin', role: 'admin' }, createdAt: '2026-09-03T10:00:00Z',
        }]} />);
        expect(screen.getByText('Chi Admin')).toBeInTheDocument();
        expect(screen.getByText(/staff only/i)).toBeInTheDocument();
        expect(screen.getByText('Contractor ref 42')).toBeInTheDocument();
    });

    it('describes priority changes', () => {
        render(<ComplaintTimeline staffView={false} entries={[{
            _id: '4', type: 'PRIORITY_CHANGED', status: 'IN_REVIEW', priorityChange: { from: 'LOW', to: 'HIGH' },
            actorLabel: 'Administrator', createdAt: '2026-09-04T10:00:00Z',
        }]} />);
        expect(screen.getByText('Priority changed from LOW to HIGH')).toBeInTheDocument();
    });

    it('labels renamed categories with their filed name', () => {
        expect(categoryLabel({ name: 'Road damage', recordedName: 'Potholes' })).toBe("Road damage (filed as 'Potholes')");
        expect(categoryLabel({ name: 'Roads', recordedName: 'Roads' })).toBe('Roads');
        expect(categoryLabel(undefined)).toBe('Uncategorized');
    });
});
