import { Sparkles } from 'lucide-react';

const FAILURE_REASONS = {
    TIMEOUT: 'The AI took too long to answer',
    RATE_LIMITED: 'The AI provider asked us to slow down, and retries ran out',
    PROVIDER_DOWN: 'The AI provider was unavailable',
    AUTH: 'The AI provider refused our key or model; check the settings',
    REFUSED: 'The AI declined this report',
    INVALID_OUTPUT: "The AI's answer could not be used",
    NOT_CONFIGURED: 'AI is not configured on this server',
    INTERNAL: 'Something went wrong on our side',
};
const INPUT = { TEXT_AND_IMAGE: 'Read the text and the photo', TEXT_ONLY: 'Read the text only' };

const AiDetails = ({ complaint }) => {
    const ai = complaint.ai ?? {};
    const provenance = [ai.provider, ai.model, ai.promptVersion && `prompt ${ai.promptVersion}`].filter(Boolean).join(' · ');
    return (
        <div className="field">
            <h3 className="field-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} color="var(--color-accent-lavender-text)" aria-hidden="true" /> AI details
            </h3>
            {ai.status === 'PENDING' && <p role="status">Classifying…</p>}
            {ai.status === 'FAILED' && (
                <p role="note" className="form-error-banner">
                    {`AI classification failed. ${FAILURE_REASONS[ai.failureCode] ?? 'Unknown reason'}.`}
                    {complaint.categorySource === 'FALLBACK' && ' The category was left as "Other"; check it.'}
                </p>
            )}
            {ai.suggestedCategory && typeof ai.confidence === 'number' && (
                <p>{`Suggested ${ai.suggestedCategory} (${Math.round(ai.confidence * 100)}%)`}</p>
            )}
            {provenance && <span className="meta">{provenance}</span>}
            {ai.inputMode && <span className="meta">{INPUT[ai.inputMode]}</span>}
        </div>
    );
};

export default AiDetails;
