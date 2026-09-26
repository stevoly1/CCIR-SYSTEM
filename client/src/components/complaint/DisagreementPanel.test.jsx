import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DisagreementPanel from './DisagreementPanel';

vi.mock('./RecategoriseDialog', () => ({ default: ({ initialCategoryId, title }) => <div role="dialog" aria-label={title}>{initialCategoryId}</div> }));

const complaint = {
    _id: 'c1', canRecategorise: true, category: { _id: 'roads', name: 'Roads' },
    ai: { disagreement: { categoryId: 'drain', name: 'Drainage', confidence: 0.9 } },
};

describe('AI disagreement', () => {
    it('offers the AI suggestion or citizen choice with each category selected', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<DisagreementPanel complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.getByText(/AI suggests Drainage \(90%\)/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: "Use AI's category" }));
        expect(screen.getByRole('dialog', { name: "Use the AI's category" })).toHaveTextContent('drain');
        rerender(<DisagreementPanel key="again" complaint={complaint} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: "Keep citizen's category" }));
        expect(screen.getByRole('dialog', { name: "Keep the citizen's category" })).toHaveTextContent('roads');
    });

    it('stays hidden without a disagreement or permission', () => {
        const { rerender } = render(<DisagreementPanel complaint={{ ...complaint, ai: { disagreement: null } }} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.queryByRole('region', { name: 'AI disagreement' })).not.toBeInTheDocument();
        rerender(<DisagreementPanel complaint={{ ...complaint, canRecategorise: false }} onUpdated={vi.fn()} onConflict={vi.fn()} />);
        expect(screen.queryByRole('region', { name: 'AI disagreement' })).not.toBeInTheDocument();
    });
});
