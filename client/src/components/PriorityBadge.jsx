import React from 'react';

const PRIORITY_STYLES = {
    LOW: { color: 'var(--color-priority-low)', label: 'Low' },
    MEDIUM: { color: 'var(--color-priority-medium)', label: 'Medium' },
    HIGH: { color: 'var(--color-priority-high)', label: 'High' },
    CRITICAL: { color: 'var(--color-priority-critical)', label: 'Critical' },
};

const PriorityBadge = ({ priority }) => {
    const style = PRIORITY_STYLES[priority] || PRIORITY_STYLES.MEDIUM;
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: style.color }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: style.color, display: 'inline-block' }} />
            {style.label}
        </span>
    );
};

export default PriorityBadge;
