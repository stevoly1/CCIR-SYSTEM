import { MapPin, Sparkles } from 'lucide-react';
import { categoryLabel } from './categoryLabel';
import { COORDINATE_SOURCE_LABELS, labelFor } from '../labels';

// The report's content. Staff see recorded coordinates (5 decimal places) and their
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
                <label>Description</label>
                <p style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 14 }}>
                    {complaint.description}
                </p>
            </div>

            <div className="field">
                <label>Category</label>
                <p>{categoryLabel(complaint.category)}</p>
            </div>

            <div className="field">
                <label>Location</label>
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

            {complaint.ai?.summary && (
                <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={14} color="var(--color-accent-lavender-text)" /> AI summary
                    </label>
                    <p style={{ color: 'var(--color-text-muted)' }}>{complaint.ai.summary}</p>
                </div>
            )}
        </>
    );
};

export default ComplaintSummary;
