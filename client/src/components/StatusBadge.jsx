import React from 'react';

const STATUS_STYLES = {
    PENDING: { bg: '#EEF0F6', color: 'var(--color-status-pending)', label: 'Pending' },
    IN_REVIEW: { bg: 'var(--color-primary-light)', color: 'var(--color-status-review)', label: 'In Review' },
    IN_PROGRESS: { bg: '#FFF3E0', color: 'var(--color-status-progress)', label: 'In Progress' },
    RESOLVED: { bg: 'var(--color-accent-mint)', color: 'var(--color-status-resolved)', label: 'Resolved' },
    REJECTED: { bg: '#FDECEE', color: 'var(--color-status-rejected)', label: 'Rejected' },
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
