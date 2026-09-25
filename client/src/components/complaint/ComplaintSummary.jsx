import { MapPin, Sparkles } from 'lucide-react';
import { categoryLabel } from './categoryLabel';
import { COORDINATE_SOURCE_LABELS, labelFor } from '../labels';

// Why the fallback was used, from the API's ai.error code.
const AI_FAILURE_REASONS = {
    TIMEOUT: 'The AI took too long to answer',
    PROVIDER_ERROR: 'The AI service refused the request or was unavailable, for example because its usage limit was reached',
    NETWORK_ERROR: 'The AI service could not be reached',
    INVALID_OUTPUT: "The AI's answer could not be used",
};

// The report's content, as read-only sections titled with headings (not form labels). Staff see recorded coordinates (5 decimal places) and their
// source; the owner sees only the address and whether a precise position exists.
const ComplaintSummary = ({ complaint, staffView }) => {
    const images = complaint.images ?? [];
    const coordinates = staffView && typeof complaint.location?.latitude === 'number' ? complaint.location : null;

    return (
        <>
            {images.length > 0 && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 8,
                    marginBottom: 20,
                }}>
                    {images.map((img) => (
                        <a key={img.url} href={img.url} target="_blank" rel="noreferrer">
                            <img
                                src={img.url}
                                alt=""
                                style={{
                                    width: '100%',
                                    height: images.length === 1 ? 320 : 140,
                                    objectFit: 'cover',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'block',
                                }}
                            />
                        </a>
                    ))}
                </div>
            )}

            <div className="field">
                <h3 className="field-heading">Description</h3>
                <p style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 14 }}>
                    {complaint.description}
                </p>
            </div>

            <div className="field">
                <h3 className="field-heading">Category</h3>
                <p>{categoryLabel(complaint.category)}</p>
            </div>

            <div className="field">
                <h3 className="field-heading">Location</h3>
                <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} /> {complaint.address || 'No address recorded'}
                </p>
                {coordinates && (
                    <span className="meta">
                        {`Coordinates: ${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)} (${labelFor(COORDINATE_SOURCE_LABELS, coordinates.coordinateSource)})`}
                    </span>
                )}
                {!staffView && complaint.hasPrecisePosition && <span className="meta">Precise position recorded</span>}
            </div>

            {staffView && complaint.ai?.error && (
                <p role="note" className="form-error-banner">
                    The AI could not classify this report, so the category and priority were set by the fallback. Check them.
                    {AI_FAILURE_REASONS[complaint.ai.error] && ` ${AI_FAILURE_REASONS[complaint.ai.error]}.`}
                </p>
            )}

            {complaint.ai?.summary && (
                <div className="field">
                    <h3 className="field-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={14} color="var(--color-accent-lavender-text)" aria-hidden="true" /> AI summary
                    </h3>
                    <p style={{ color: 'var(--color-text-muted)' }}>{complaint.ai.summary}</p>
                    {staffView && typeof complaint.ai.confidence === 'number' && (
                        <span className="meta">{`Confidence ${Math.round(complaint.ai.confidence * 100)}%`}</span>
                    )}
                    {staffView && complaint.ai.tags?.length > 0 && (
                        <span className="meta">{`Tags: ${complaint.ai.tags.join(', ')}`}</span>
                    )}
                </div>
            )}

            {staffView && complaint.resolvedAt && (
                <p className="meta">
                    {`Resolved on ${new Date(complaint.resolvedAt).toLocaleString()}${complaint.resolvedAtEstimated ? ' (estimated)' : ''}`}
                </p>
            )}
        </>
    );
};

export default ComplaintSummary;
