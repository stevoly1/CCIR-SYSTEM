import { render, screen } from '@testing-library/react';
import AiDetails from './AiDetails';

const base = { categorySource: 'AI', ai: { status: 'DONE', suggestedCategory: 'Roads', confidence: 0.82, provider: 'kimi', model: 'kimi-k2.6', promptVersion: 'classify-v1', inputMode: 'TEXT_AND_IMAGE', failureCode: null, disagreement: null } };

describe('AI details for staff', () => {
    it('shows the suggestion, confidence and provenance', () => {
        render(<AiDetails complaint={base} />);
        expect(screen.getByRole('heading', { name: 'AI details' })).toBeInTheDocument();
        expect(screen.getByText('Suggested Roads (82%)')).toBeInTheDocument();
        expect(screen.getByText('kimi · kimi-k2.6 · prompt classify-v1')).toBeInTheDocument();
        expect(screen.getByText('Read the text and the photo')).toBeInTheDocument();
    });

    it('says when classification is pending', () => {
        render(<AiDetails complaint={{ ...base, ai: { ...base.ai, status: 'PENDING' } }} />);
        expect(screen.getByText('Classifying…')).toBeInTheDocument();
        expect(screen.queryByText('Suggested Roads (82%)')).not.toBeInTheDocument();
    });

    it('shows legacy provider provenance without missing fields', () => {
        render(<AiDetails complaint={{ categorySource: 'AI', ai: { status: 'DONE', provider: 'gemini' } }} />);
        expect(screen.getByText('gemini')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('undefined');
    });

    it.each([
        ['TIMEOUT', 'The AI took too long to answer'],
        ['RATE_LIMITED', 'The AI provider asked us to slow down, and retries ran out'],
        ['PROVIDER_DOWN', 'The AI provider was unavailable'],
        ['AUTH', 'The AI provider refused our key or model; check the settings'],
        ['REFUSED', 'The AI declined this report'],
        ['INVALID_OUTPUT', "The AI's answer could not be used"],
        ['NOT_CONFIGURED', 'AI is not configured on this server'],
    ])('explains a failure: %s', (code, message) => {
        render(<AiDetails complaint={{ ...base, categorySource: 'FALLBACK', ai: { status: 'FAILED', failureCode: code } }} />);
        expect(screen.getByRole('note')).toHaveTextContent(`AI classification failed. ${message}.`);
    });
});
