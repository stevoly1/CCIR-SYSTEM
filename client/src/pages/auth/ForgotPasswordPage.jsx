import { useState } from 'react';
import { Link } from 'react-router';
import AuthLayout from '../../layouts/AuthLayout';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';

// Same answer whether or not the address has an account: the API reveals nothing, and neither does this.
const ForgotPasswordPage = () => {
    const [email, setEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSending(true);
        setError('');
        try {
            await axiosClient.post('/auth/password/forgot', { email });
            setSent(true);
        } catch (err) {
            setError(extractErrorMessage(err));
        } finally {
            setSending(false);
        }
    };

    return (
        <AuthLayout>
            <h2>Reset your password</h2>
            {sent ? (
                <p className="auth-subtitle" role="status">
                    If an account uses {email}, we have sent it a link to reset the password. The link expires in 30 minutes.
                </p>
            ) : (
                <>
                    <p className="auth-subtitle">Enter your account's email address and we will send you a link to choose a new password.</p>
                    {error && <div className="form-error-banner">{error}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="email">Email</label>
                            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                        </div>
                        <button className="btn btn-primary btn-block" type="submit" disabled={sending}>
                            {sending ? <span className="spinner" /> : 'Send reset link'}
                        </button>
                    </form>
                </>
            )}
            <div className="auth-switch">
                <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Back to sign in</Link>
            </div>
        </AuthLayout>
    );
};

export default ForgotPasswordPage;
