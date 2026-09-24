import StatusBadge from '../StatusBadge';
import { PRIORITY_LABELS, labelFor } from '../labels';

// Renders the presenter's timeline contract. Citizens receive role-level `actorLabel`s
// and public notes only; the staff view adds `actor` identities and internal notes.

const priorityText = (change) => `Priority changed from ${labelFor(PRIORITY_LABELS, change.from)} to ${labelFor(PRIORITY_LABELS, change.to)}`;

const ComplaintTimeline = ({ entries = [], staffView = false }) => (
    <ol className="card-list" aria-label="Report timeline" style={{ listStyle: 'none', padding: 0 }}>
        {[...entries].reverse().map((entry) => (
            <li key={entry._id} className="complaint-card" style={{ alignItems: 'flex-start' }}>
                <div className="complaint-info">
                    <StatusBadge status={entry.status} />
                    {entry.priorityChange && <p style={{ marginTop: 8 }}>{priorityText(entry.priorityChange)}</p>}
                    {entry.publicNote && <p style={{ marginTop: 8 }}>{entry.publicNote}</p>}
                    {staffView && entry.internalNote && (
                        <p style={{ marginTop: 8, color: 'var(--color-text-muted)' }}>
                            <strong>Staff only: </strong><span>{entry.internalNote}</span>
                        </p>
                    )}
                    <div className="meta" style={{ marginTop: 6 }}>
                        <span>{staffView && entry.actor ? entry.actor.displayName : entry.actorLabel}</span>
                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                </div>
            </li>
        ))}
    </ol>
);

export default ComplaintTimeline;
