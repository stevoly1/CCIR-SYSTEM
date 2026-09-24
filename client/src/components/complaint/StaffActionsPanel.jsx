import { useState } from 'react';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import { RELOAD_CODES, updateComplaintStatus } from '../../slices/complaintSlice';
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, labelFor } from '../labels';


// Status and priority controls driven entirely by server-computed permissions:
// the status list is `allowedTransitions`, and nothing unchanged is sent.
const StaffActionsPanel = ({ complaint, onUpdated, onConflict }) => {
    const dispatch = useDispatch();
    const [status, setStatus] = useState('');
    const [priority, setPriority] = useState(complaint.priority);
    const [publicNote, setPublicNote] = useState('');
    const [internalNote, setInternalNote] = useState('');
    const [busy, setBusy] = useState(false);

    if (complaint.allowedTransitions.length === 0 && !complaint.canChangePriority) {
        return <p className="meta">Only the assigned staff member can update this report.</p>;
    }

    const priorityChanged = priority !== complaint.priority;
    const hasChange = Boolean(status) || priorityChanged;

    const submit = async (event) => {
        event.preventDefault();
        const body = { id: complaint._id, expectedVersion: complaint.version };
        if (status) body.status = status;
        if (priorityChanged) body.priority = priority;
        if (publicNote.trim()) body.publicNote = publicNote.trim();
        if (internalNote.trim()) body.internalNote = internalNote.trim();
        setBusy(true);
        const result = await dispatch(updateComplaintStatus(body));
        setBusy(false);
        if (updateComplaintStatus.fulfilled.match(result)) {
            toast.success('Report updated');
            setStatus('');
            setPublicNote('');
            setInternalNote('');
            onUpdated(result.payload);
        } else if (RELOAD_CODES.includes(result.payload?.code)) {
            toast.error('This report changed — reloaded');
            onConflict();
        } else if (result.payload?.code === 'NOT_ASSIGNED_TO_YOU') {
            toast.error('Only the assigned staff member can update this report.');
            onConflict();
        } else {
            toast.error(result.payload?.message || 'Failed to update report');
        }
    };

    return (
        <form
            onSubmit={submit}
            style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 }}
        >
            <div className="field">
                <label htmlFor="staff-status">Status</label>
                <select
                    id="staff-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={complaint.allowedTransitions.length === 0}
                >
                    <option value="">No status change</option>
                    {complaint.allowedTransitions.map((s) => <option key={s} value={s}>{labelFor(STATUS_LABELS, s)}</option>)}
                </select>
            </div>
            {complaint.canChangePriority && (
                <div className="field">
                    <label htmlFor="staff-priority">Priority</label>
                    <select id="staff-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                </div>
            )}
            <div className="field">
                <label htmlFor="staff-public-note">Public note (visible to the reporter)</label>
                <textarea id="staff-public-note" rows={3} maxLength={500} value={publicNote} onChange={(e) => setPublicNote(e.target.value)} />
            </div>
            <div className="field">
                <label htmlFor="staff-internal-note">Internal note (staff only)</label>
                <textarea id="staff-internal-note" rows={3} maxLength={1000} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !hasChange}>Save update</button>
        </form>
    );
};

export default StaffActionsPanel;
