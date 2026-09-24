
import { STATUS_LABELS } from './labels';

const STATUS_STYLES = {
    PENDING: { bg: '#EEF0F6', color: 'var(--color-status-pending)', label: STATUS_LABELS.PENDING },
    IN_REVIEW: { bg: 'var(--color-primary-light)', color: 'var(--color-status-review)', label: STATUS_LABELS.IN_REVIEW },
    IN_PROGRESS: { bg: '#FFF3E0', color: 'var(--color-status-progress)', label: STATUS_LABELS.IN_PROGRESS },
    RESOLVED: { bg: 'var(--color-accent-mint)', color: 'var(--color-status-resolved)', label: STATUS_LABELS.RESOLVED },
    REJECTED: { bg: '#FDECEE', color: 'var(--color-status-rejected)', label: STATUS_LABELS.REJECTED },
    WITHDRAWN: { bg: '#F1F1F1', color: 'var(--color-text-muted)', label: STATUS_LABELS.WITHDRAWN },
};

const StatusBadge = ({ status }) => {
    const style = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
    return (
        <span className="badge" style={{ background: style.bg, color: style.color }}>
            {style.label}
        </span>
    );
};

export default StatusBadge;
