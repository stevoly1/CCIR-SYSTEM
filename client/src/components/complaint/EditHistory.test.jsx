import { render, screen } from '@testing-library/react';
import EditHistory from './EditHistory';

describe('EditHistory', () => {
    it('lists what the reporter changed, when, and whether the AI re-analysed it', () => {
        render(<EditHistory entries={[
            { editedAt: '2026-09-24T19:31:00.000Z', editedBy: { displayName: 'Cara Citizen' }, fields: ['description', 'location'], reanalysed: true },
            { editedAt: '2026-09-24T19:40:00.000Z', editedBy: { displayName: 'Cara Citizen' }, fields: ['location'], reanalysed: false },
        ]} />);
        const list = screen.getByRole('list', { name: "Reporter's edits" });
        expect(list).toHaveTextContent('Description and location changed by Cara Citizen');
        expect(list).toHaveTextContent('re-analysed by the AI');
        expect(list).toHaveTextContent('Location changed by Cara Citizen');
    });

    it('renders nothing when the report was never edited', () => {
        const { container } = render(<EditHistory entries={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});
