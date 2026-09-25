import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import Topbar from '../../components/Topbar';
import { updateProfile } from '../../slices/authSlice';
import ChangePasswordForm from '../../components/account/ChangePasswordForm';
import ChangeEmailForm from '../../components/account/ChangeEmailForm';
import DeleteAccountSection from '../../components/account/DeleteAccountSection';

const ProfilePage = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state) => state.auth);
    const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '' });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        const result = await dispatch(updateProfile(form));
        setSaving(false);
        if (updateProfile.fulfilled.match(result)) {
            toast.success('Profile updated');
        } else {
            toast.error(result.payload || 'Failed to update profile');
        }
    };

    return (
        <div>
            <Topbar title="Profile" subtitle="Manage your account details." />

            <form onSubmit={handleSubmit} style={{ maxWidth: 480, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 24 }}>
                <div className="field">
                    <label htmlFor="profile-email">Email</label>
                    <input id="profile-email" value={user?.email || ''} disabled />
                </div>
                <div className="field">
                    <label htmlFor="profile-role">Role</label>
                    <input id="profile-role" value={user?.role || ''} disabled style={{ textTransform: 'capitalize' }} />
                </div>
                <div className="field">
                    <label htmlFor="name">Full name</label>
                    <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
                </div>
                <div className="field">
                    <label htmlFor="phone">Phone</label>
                    <input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Optional" />
                </div>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? <span className="spinner" /> : 'Save changes'}
                </button>
            </form>

            {user?.authProvider !== 'google' && <ChangePasswordForm />}
            {user?.authProvider !== 'google' && <ChangeEmailForm />}
            {user?.authProvider === 'google' && (
                <p className="profile-section">You sign in with Google, which manages your password and email address.</p>
            )}
            {user && <DeleteAccountSection user={user} />}
        </div>
    );
};

export default ProfilePage;
