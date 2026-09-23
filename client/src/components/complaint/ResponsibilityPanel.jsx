import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import ConfirmModal from '../ConfirmModal';
import { assignComplaint, RELOAD_CODES } from '../../slices/complaintSlice';

const EVENT_LABELS = {
    ASSIGNED: 'Assigned',
    REASSIGNED: 'Reassigned',
    UNASSIGNED: 'Unassigned',
    RETIREMENT_UNASSIGNMENT: 'Unassigned (account retired)',
    WITHDRAWAL_UNASSIGNMENT: 'Unassigned (report withdrawn)',
    LEGACY_STATE_IMPORT: 'Imported assignment',
};

// Staff view of who is responsible. Only administrators (server-reported `canAssign`)
// get assignment controls, and only against the server's assignable-user list.
const ResponsibilityPanel = ({ complaint, onUpdated, onConflict }) => {
    const dispatch = useDispatch();
    const [candidates, setCandidates] = useState([]);
    const [target, setTarget] = useState('');
    const [reason, setReason] = useState('');
    // Holds the assignee's name while the unassign confirmation is open, so the dialog never
    // reads a store value that the request may clear before it settles.
    const [confirmingName, setConfirmingName] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!complaint.canAssign) return;
        axiosClient.get('/users/assignable')
            .then(({ data }) => setCandidates(data.users))
            .catch(() => toast.error('Could not load assignable staff'));
    }, [complaint.canAssign]);

    const send = async (assignedTo) => {
        // Clear the inputs at submission, not after the response: the store can show the
        // new assignee before this request settles, and a choice made in that window must
        // not be wiped. On failure the submitted values are restored.
        const submittedTarget = target;
        const submittedReason = reason;
        setTarget('');
        setReason('');
        setConfirmingName(null);
        setBusy(true);
        const result = await dispatch(assignComplaint({
            id: complaint._id,
            assignedTo,
            ...(assignedTo && submittedReason.trim() ? { reason: submittedReason.trim() } : {}),
            expectedVersion: complaint.version,
        }));
        setBusy(false);
        if (assignComplaint.fulfilled.match(result)) {
            toast.success(assignedTo ? 'Assignment saved' : 'Report unassigned');
            onUpdated(result.payload);
            return;
        }
        setTarget(submittedTarget);
        setReason(submittedReason);
        if (RELOAD_CODES.includes(result.payload?.code)) {
            toast.error('This report changed — reloaded');
            onConflict();
        } else {
            toast.error(result.payload?.message || 'Assignment failed');
        }
    };

    return (
        <section aria-label="Responsibility" style={{ marginBottom: 20 }}>
            <div className="section-header"><h2>Responsibility</h2></div>
            <p>{complaint.assignee ? complaint.assignee.displayName : 'Not assigned'}</p>
            {complaint.canAssign && (
                <>
                    <div className="field">
                        <label htmlFor="assign-target">Assign to</label>
                        <select id="assign-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                            <option value="">Choose agency staff…</option>
                            {candidates
                                .filter((candidate) => candidate.userId !== complaint.assignee?.userId)
                                .map((candidate) => (
                                    <option key={candidate.userId} value={candidate.userId}>{candidate.displayName}</option>
                                ))}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="assign-reason">Assignment reason (optional)</label>
                        <input id="assign-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" className="btn btn-primary" disabled={!target || busy} onClick={() => send(target)}>
                            {complaint.assignee ? 'Reassign' : 'Assign'}
                        </button>
                        {complaint.assignee && (
                            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setConfirmingName(complaint.assignee.displayName)}>
                                Unassign
                            </button>
                        )}
                    </div>
                </>
            )}
            {complaint.assignmentHistory?.length > 0 && (
                <ul className="meta" aria-label="Assignment history" style={{ marginTop: 12 }}>
                    {[...complaint.assignmentHistory].reverse().map((entry, index) => (
                        <li key={`${entry.createdAt}-${index}`}>
                            {EVENT_LABELS[entry.type] ?? entry.type}
                            {entry.next ? ` to ${entry.next.displayName}` : ''}
                            {entry.changedBy ? ` by ${entry.changedBy.displayName}` : ''}
                            {entry.reason ? ` — ${entry.reason}` : ''}
                            {` (${new Date(entry.createdAt).toLocaleString()})`}
                        </li>
                    ))}
                </ul>
            )}
            {confirmingName && (
                <ConfirmModal
                    title="Unassign report"
                    message={`Remove ${confirmingName} from this report?`}
                    confirmLabel="Confirm unassign"
                    loading={busy}
                    onConfirm={() => send(null)}
                    onClose={() => setConfirmingName(null)}
                />
            )}
        </section>
    );
};

export default ResponsibilityPanel;
