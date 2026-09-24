
import { PRIORITY_LABELS } from './labels';

const PRIORITY_STYLES = {
    LOW: { color: 'var(--color-priority-low)', label: PRIORITY_LABELS.LOW },
    MEDIUM: { color: 'var(--color-priority-medium)', label: PRIORITY_LABELS.MEDIUM },
    HIGH: { color: 'var(--color-priority-high)', label: PRIORITY_LABELS.HIGH },
    CRITICAL: { color: 'var(--color-priority-critical)', label: PRIORITY_LABELS.CRITICAL },
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
