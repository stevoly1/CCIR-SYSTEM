import { useEffect, useRef, useState } from 'react';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';
import { emailChangeMessage } from './emailChangeProgress';

// The change applies only when the user confirms at the new address. It sits inside the edit
// dialog, so its errors and progress show here rather than as toasts behind the dialog.
const AdminEmailChange = ({ user, isSelf }) => {
    const [open, setOpen] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [answered, setAnswered] = useState(null);
    const openButton = useRef(null);
    const progress = useRef(null);
    const wasOpen = useRef(false);
    // Where focus goes when the field closes: the progress after a send, else the button.
    const focusAfterClose = useRef('button');

    useEffect(() => {
        if (open) {
            wasOpen.current = true;
            return;
        }
        if (!wasOpen.current) return;
        wasOpen.current = false;
        (focusAfterClose.current === 'progress' ? progress : openButton).current?.focus();
        focusAfterClose.current = 'button';
    }, [open]);

    if (user.authProvider === 'google') return <p className="field-hint">Managed by Google</p>;
    if (isSelf) return <p className="field-hint">Change your own address from your profile</p>;

    const message = emailChangeMessage(answered ?? user.pendingEmailChange ?? null, { admin: true });
    const progressLine = message && <p role={message.role} tabIndex={-1} ref={progress}>{message.text}</p>;

    if (!open) {
        return (
            <div>
                {progressLine}
                <button className="btn btn-outline" type="button" ref={openButton} onClick={() => { setError(''); setOpen(true); }}>Change email</button>
            </div>
        );
    }

    const send = async () => {
        setSending(true);
        setError('');
        try {
            const { data } = await axiosClient.post(`/users/${user._id}/email`, { newEmail });
            setAnswered(data.pendingEmailChange);
            setNewEmail('');
            focusAfterClose.current = 'progress';
            setOpen(false);
        } catch (err) {
            setError(extractErrorMessage(err));
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
            {progressLine}
            <label htmlFor="admin-new-email">New email address</label>
            <input id="admin-new-email" type="email" autoFocus value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setError(''); }} onKeyDown={sendOnEnter} />
            {error && <p role="alert" className="field-error">{error}</p>}
            <button className="btn btn-primary" type="button" onClick={send} disabled={sending || !newEmail}>
                {sending ? <span className="spinner" /> : 'Send confirmation'}
            </button>
            <button className="btn btn-outline" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
    );
};

export default AdminEmailChange;
