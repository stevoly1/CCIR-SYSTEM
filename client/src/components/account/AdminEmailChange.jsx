import { useState } from 'react';
import toast from 'react-hot-toast';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';

// The change applies only when the user confirms at the new address.
const AdminEmailChange = ({ user, isSelf }) => {
    const [open, setOpen] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [sending, setSending] = useState(false);

    if (user.authProvider === 'google') return <p className="field-hint">Managed by Google</p>;
    if (isSelf) return <p className="field-hint">Change your own address from your profile</p>;
    if (!open) {
        return <button className="btn btn-outline" type="button" onClick={() => setOpen(true)}>Change email</button>;
    }

    const send = async () => {
        setSending(true);
        try {
            await axiosClient.post(`/users/${user._id}/email`, { newEmail });
            toast.success(`Confirmation sent to ${newEmail}. The address changes when the user confirms it.`);
            setOpen(false);
            setNewEmail('');
        } catch (err) {
            toast.error(extractErrorMessage(err));
        } finally {
            setSending(false);
        }
    };

    // Enter would otherwise submit the edit form this sits in, saving the dialog instead.
    const sendOnEnter = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (newEmail && !sending) send();
    };

    return (
        <div className="field">
            <label htmlFor="admin-new-email">New email address</label>
            <input id="admin-new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={sendOnEnter} />
            <button className="btn btn-primary" type="button" onClick={send} disabled={sending || !newEmail}>
                {sending ? <span className="spinner" /> : 'Send confirmation'}
            </button>
        </div>
    );
};

export default AdminEmailChange;
