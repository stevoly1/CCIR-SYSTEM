import { useState } from 'react';
import toast from 'react-hot-toast';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';

const ChangeEmailForm = () => {
    const [form, setForm] = useState({ newEmail: '', currentPassword: '' });
    const [saving, setSaving] = useState(false);
    const [sentTo, setSentTo] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await axiosClient.post('/users/profile/email', { newEmail: form.newEmail, currentPassword: form.currentPassword });
            setSentTo(form.newEmail);
            setForm({ newEmail: '', currentPassword: '' });
        } catch (err) {
            toast.error(extractErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} aria-labelledby="email-heading" className="profile-section">
            <h3 id="email-heading">Email address</h3>
            {sentTo && (
                <p role="status">
                    We sent a confirmation link to {sentTo}. Your address changes when you open it; the link expires in 24 hours.
                </p>
            )}
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
