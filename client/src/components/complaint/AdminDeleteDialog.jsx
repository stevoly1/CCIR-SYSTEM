import { useState } from 'react';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import { deleteComplaint } from '../../slices/complaintSlice';

// Administrator-only permanent deletion; the server records the required reason.
const AdminDeleteDialog = ({ complaint, onClose, onDeleted }) => {
    const dispatch = useDispatch();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const confirm = async (event) => {
        event.preventDefault();
        setBusy(true);
        const result = await dispatch(deleteComplaint({ id: complaint._id, reason: reason.trim(), expectedVersion: complaint.version }));
        setBusy(false);
        if (deleteComplaint.fulfilled.match(result)) {
            toast.success('Report permanently deleted');
            onDeleted();
        } else {
            toast.error(result.payload?.message || 'Failed to delete report');
        }
    };

    return (
        <Modal title="Delete permanently" onClose={onClose} width={420}>
            <form onSubmit={confirm}>
                <p style={{ marginBottom: 12 }}>This removes the report for everyone. Use it only for spam, abuse, or test data.</p>
                <div className="field">
                    <label htmlFor="delete-reason">Reason (required)</label>
                    <textarea id="delete-reason" rows={3} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <button
                    type="submit"
                    className="btn btn-block"
                    disabled={busy || !reason.trim()}
                    style={{ background: 'var(--color-status-rejected)', color: '#fff' }}
                >
                    Delete permanently
                </button>
            </form>
        </Modal>
    );
};

export default AdminDeleteDialog;
