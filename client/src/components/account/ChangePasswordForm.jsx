import { useState } from 'react';
import toast from 'react-hot-toast';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';

const EMPTY = { currentPassword: '', newPassword: '', repeat: '' };

const ChangePasswordForm = () => {
    const [form, setForm] = useState(EMPTY);
    const [saving, setSaving] = useState(false);
    const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (form.newPassword !== form.repeat) {
            toast.error('The new passwords do not match');
            return;
        }
        setSaving(true);
        try {
            await axiosClient.post('/users/profile/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
            toast.success('Password changed. Your other devices have been signed out.');
            setForm(EMPTY);
        } catch (err) {
            toast.error(extractErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} aria-labelledby="password-heading" className="profile-section">
            <h3 id="password-heading">Password</h3>
            <div className="field">
                <label htmlFor="current-password">Current password</label>
                <input id="current-password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
            </div>
            <div className="field">
                <label htmlFor="new-password">New password</label>
                <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="At least 8 characters" value={form.newPassword} onChange={set('newPassword')} required />
            </div>
            <div className="field">
                <label htmlFor="repeat-new-password">Repeat new password</label>
                <input id="repeat-new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.repeat} onChange={set('repeat')} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? <span className="spinner" /> : 'Change password'}
            </button>
        </form>
    );
};

export default ChangePasswordForm;
