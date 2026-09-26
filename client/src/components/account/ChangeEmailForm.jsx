import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';
import { fetchProfile } from '../../slices/authSlice';
import { emailChangeMessage, isSending } from './emailChangeProgress';

const POLL_MS = 3000;
const POLL_LIMIT = 20;

// The old address is told first, then the link goes to the new one, both from a background job;
// the profile's pendingEmailChange shows how far it got.
const ChangeEmailForm = () => {
    const dispatch = useDispatch();
    const stored = useSelector((state) => state.auth.user?.pendingEmailChange ?? null);
    // The request's own answer shows at once, until the profile has been read again after it.
    const [answered, setAnswered] = useState(null);
    const [form, setForm] = useState({ newEmail: '', currentPassword: '' });
    const [saving, setSaving] = useState(false);
    const change = answered && answered.before === stored ? answered.change : stored;
    const sending = isSending(change);

    // While the emails are being sent, read the profile every few seconds, for a minute at most.
    useEffect(() => {
        if (!sending) return undefined;
        let polls = 0;
        const timer = setInterval(() => {
            polls += 1;
            dispatch(fetchProfile());
            if (polls >= POLL_LIMIT) clearInterval(timer);
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [sending, dispatch]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { data } = await axiosClient.post('/users/profile/email', { newEmail: form.newEmail, currentPassword: form.currentPassword });
            setAnswered({ change: data.pendingEmailChange, before: stored });
            setForm({ newEmail: '', currentPassword: '' });
            dispatch(fetchProfile());
        } catch (err) {
            toast.error(extractErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const message = emailChangeMessage(change);
    return (
        <form onSubmit={handleSubmit} aria-labelledby="email-heading" className="profile-section">
            <h3 id="email-heading">Email address</h3>
            {message && <p role={message.role}>{message.text}</p>}
            <div className="field">
                <label htmlFor="new-email">New email address</label>
                <input id="new-email" type="email" autoComplete="email" value={form.newEmail} onChange={(e) => setForm({ ...form, newEmail: e.target.value })} required />
            </div>
            <div className="field">
                <label htmlFor="email-password">Your password</label>
                <input id="email-password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? <span className="spinner" /> : 'Send confirmation link'}
            </button>
        </form>
    );
};

export default ChangeEmailForm;
