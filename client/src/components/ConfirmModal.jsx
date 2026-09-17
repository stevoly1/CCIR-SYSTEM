import React from 'react';
import Modal from './Modal';

const ConfirmModal = ({ title = 'Are you sure?', message, confirmLabel = 'Delete', onConfirm, onClose, loading }) => {
    return (
        <Modal title={title} onClose={onClose} width={380}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>{message}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>
                    Cancel
                </button>
                <button
                    type="button"
                    className="btn"
                    style={{ background: 'var(--color-status-rejected)', color: '#fff' }}
                    onClick={onConfirm}
                    disabled={loading}
                >
                    {loading ? <span className="spinner" /> : confirmLabel}
                </button>
            </div>
        </Modal>
    );
};

export default ConfirmModal;
