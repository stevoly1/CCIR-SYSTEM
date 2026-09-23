import { useState } from 'react';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import LocationField from '../LocationField';
import { locationToJson } from '../locationValue';
import { editComplaint, RELOAD_CODES, withdrawComplaint } from '../../slices/complaintSlice';

// Reporter actions on their own PENDING complaint, shown only when the server says so.
// Edits send only what changed plus the loaded version; conflicts reload the complaint.
const OwnerActionsPanel = ({ complaint, onUpdated, onConflict }) => {
    const dispatch = useDispatch();
    const [editing, setEditing] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [description, setDescription] = useState(complaint.description);
    const [location, setLocation] = useState({ address: complaint.address ?? '' });
    const [locationDirty, setLocationDirty] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');

    if (!complaint.canEdit && !complaint.canWithdraw) return null;

    // The panel stays mounted across refreshes (so notices survive); each edit starts
    // from the latest server data rather than a stale draft.
    const openEditor = () => {
        setDescription(complaint.description);
        setLocation({ address: complaint.address ?? '' });
        setLocationDirty(false);
        setEditing(true);
    };

    const handleFailure = (payload) => {
        if (RELOAD_CODES.includes(payload?.code)) {
            toast.error('This report changed — reloaded');
            onConflict();
        } else {
            toast.error(payload?.message || 'Something went wrong');
        }
    };

    const save = async (event) => {
        event.preventDefault();
        const body = { id: complaint._id, expectedVersion: complaint.version };
        if (description !== complaint.description) body.description = description;
        if (locationDirty) body.location = locationToJson(location);
        setBusy(true);
        const result = await dispatch(editComplaint(body));
        setBusy(false);
        if (editComplaint.fulfilled.match(result)) {
            setEditing(false);
            setLocationDirty(false);
            setNotice(result.payload.reanalysed ? 'Your report was re-analysed' : 'Report updated');
            onUpdated(result.payload.complaint);
        } else {
            handleFailure(result.payload);
        }
    };

    const withdraw = async () => {
        setBusy(true);
        const result = await dispatch(withdrawComplaint({
            id: complaint._id,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            expectedVersion: complaint.version,
        }));
        setBusy(false);
        if (withdrawComplaint.fulfilled.match(result)) {
            setWithdrawing(false);
            toast.success('Report withdrawn');
            onUpdated(result.payload);
        } else {
            handleFailure(result.payload);
        }
    };

    return (
        <section aria-label="Your actions" style={{ marginTop: 24 }}>
            <p role="status" aria-live="polite" className="meta">{notice}</p>
            <div style={{ display: 'flex', gap: 10 }}>
                {complaint.canEdit && (
                    <button type="button" className="btn btn-outline" onClick={openEditor}>Edit report</button>
                )}
                {complaint.canWithdraw && (
                    <button type="button" className="btn btn-outline" onClick={() => setWithdrawing(true)}>Withdraw report</button>
                )}
            </div>
            {editing && (
                <Modal title="Edit report" onClose={() => setEditing(false)}>
                    <form onSubmit={save}>
                        <div className="field">
                            <label htmlFor="edit-description">Description</label>
                            <textarea
                                id="edit-description"
                                rows={5}
                                value={description}
                                minLength={10}
                                maxLength={2000}
                                required
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                        <LocationField
                            id="edit-address"
                            value={location}
                            onChange={(next) => { setLocation(next); setLocationDirty(true); }}
                        />
                        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Save changes</button>
                    </form>
                </Modal>
            )}
            {withdrawing && (
                <Modal title="Withdraw report" onClose={() => setWithdrawing(false)} width={420}>
                    <p style={{ marginBottom: 12 }}>Withdrawn reports stay in your history but are no longer handled.</p>
                    <div className="field">
                        <label htmlFor="withdraw-reason">Reason (optional)</label>
                        <textarea id="withdraw-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-outline" onClick={() => setWithdrawing(false)} disabled={busy}>Cancel</button>
                        <button type="button" className="btn btn-primary" onClick={withdraw} disabled={busy}>Withdraw</button>
                    </div>
                </Modal>
            )}
        </section>
    );
};

export default OwnerActionsPanel;
