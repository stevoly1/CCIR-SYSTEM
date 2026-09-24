import { useId, useState } from 'react';
import Modal from './Modal';

// A confirmation that can carry an optional reason, recorded with the change on the server.
// `withReason` false makes it a plain confirmation. While the action runs it cannot be dismissed.
const ReasonDialog = ({ title, message, confirmLabel, onConfirm, onClose, loading, danger = false, withReason = true }) => {
    const [reason, setReason] = useState('');
    const reasonId = useId();

    return (
        <Modal title={title} onClose={loading ? () => {} : onClose} width={420}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>{message}</p>
            {withReason && (
                <div className="field">
                    <label htmlFor={reasonId}>Reason (optional)</label>
                    <textarea id={reasonId} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>Cancel</button>
                <button
                    type="button"
                    className={danger ? 'btn' : 'btn btn-primary'}
                    style={danger ? { background: 'var(--color-status-rejected)', color: '#fff' } : undefined}
                    onClick={() => onConfirm(reason.trim())}
                    disabled={loading}
                >
                    {loading ? <span className="spinner" /> : confirmLabel}
                </button>
            </div>
        </Modal>
    );
};

export default ReasonDialog;
