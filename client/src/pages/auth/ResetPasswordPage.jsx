import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import AuthLayout from '../../layouts/AuthLayout';
import axiosClient, { extractErrorCode, extractErrorMessage } from '../../api/axiosClient';
import { clearLinkFragment, readLinkToken } from '../../routes/linkToken';

const ResetPasswordPage = () => {
    const navigate = useNavigate();
    const [token] = useState(() => readLinkToken(window.location.hash));
    const [form, setForm] = useState({ password: '', repeat: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [expired, setExpired] = useState(false);

    useEffect(() => { clearLinkFragment(); }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (form.password !== form.repeat) {
            setError('The passwords do not match');
            return;
        }
        setSaving(true);
        try {
            await axiosClient.post('/auth/password/reset', { token, password: form.password });
            toast.success('Password reset. Sign in with your new password.');
            navigate('/login', { replace: true });
        } catch (err) {
            if (extractErrorCode(err) === 'INVALID_OR_EXPIRED_TOKEN') setExpired(true);
            else setError(extractErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const newLink = <Link to="/forgot-password" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Request a new link</Link>;

    return (
        <AuthLayout>
            <h2>Choose a new password</h2>
            {!token && <p className="auth-subtitle"><span>This link is incomplete.</span> {newLink}</p>}
            {token && expired && <p className="auth-subtitle"><span>This link is invalid or has expired.</span> {newLink}</p>}
            {token && !expired && (
                <>
                    {error && <div className="form-error-banner">{error}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="new-password">New password</label>
                            <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="At least 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                        </div>
                        <div className="field">
                            <label htmlFor="repeat-password">Repeat new password</label>
                            <input id="repeat-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} required />
                        </div>
                        <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
                            {saving ? <span className="spinner" /> : 'Set new password'}
                        </button>
                    </form>
                </>
            )}
        </AuthLayout>
    );
};

export default ResetPasswordPage;
