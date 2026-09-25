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

    describe('what staff see about the AI and the outcome', () => {
        const staffAi = { summary: 'AI text', tags: ['roads', 'safety'], confidence: 0.9, suggestedCategory: 'Roads', error: null };

        it('shows the AI\'s confidence and tags', () => {
            render(<ComplaintSummary staffView complaint={{ ...base, ai: staffAi }} />);
            expect(screen.getByText('Confidence 90%')).toBeInTheDocument();
            expect(screen.getByText('Tags: roads, safety')).toBeInTheDocument();
        });

        it('warns when the AI failed and a fallback set the category and priority', () => {
            render(<ComplaintSummary staffView complaint={{ ...base, ai: { ...staffAi, summary: '', confidence: 0, tags: [], error: 'TIMEOUT' } }} />);
            expect(screen.getByRole('note')).toHaveTextContent('The AI could not classify this report');
        });

        it.each([
            ['TIMEOUT', 'The AI took too long to answer'],
            ['PROVIDER_ERROR', 'The AI service refused the request or was unavailable, for example because its usage limit was reached'],
            ['NETWORK_ERROR', 'The AI service could not be reached'],
            ['INVALID_OUTPUT', "The AI's answer could not be used"],
        ])('says why the AI fell back (%s)', (error, reason) => {
            render(<ComplaintSummary staffView complaint={{ ...base, ai: { ...staffAi, error } }} />);
            expect(screen.getByRole('note')).toHaveTextContent(reason);
        });

        it('still warns for a reason it does not know', () => {
            render(<ComplaintSummary staffView complaint={{ ...base, ai: { ...staffAi, error: 'SOMETHING_NEW' } }} />);
            expect(screen.getByRole('note')).toHaveTextContent('The AI could not classify this report');
        });

        it('shows when a report was resolved, and says when that date is estimated', () => {
            const { rerender } = render(<ComplaintSummary staffView complaint={{ ...base, status: 'RESOLVED', resolvedAt: '2026-09-20T10:00:00.000Z', resolvedAtEstimated: false }} />);
            expect(screen.getByText(/^Resolved on /)).not.toHaveTextContent('estimated');
            rerender(<ComplaintSummary staffView complaint={{ ...base, status: 'RESOLVED', resolvedAt: '2026-09-20T10:00:00.000Z', resolvedAtEstimated: true }} />);
            expect(screen.getByText(/^Resolved on /)).toHaveTextContent('(estimated)');
        });

        it('keeps these staff details from the reporter', () => {
            render(<ComplaintSummary staffView={false} complaint={{ ...base, ai: { summary: 'AI text', tags: ['roads'] } }} />);
            expect(screen.queryByText(/Confidence|Tags:/)).not.toBeInTheDocument();
        });
    });
});
