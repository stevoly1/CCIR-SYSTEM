import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import AuthLayout from '../../layouts/AuthLayout';
import axiosClient, { extractErrorCode, extractErrorMessage } from '../../api/axiosClient';
import { clearLinkFragment, readLinkToken } from '../../routes/linkToken';
import { fetchProfile } from '../../slices/authSlice';

// Confirms on a click, not on load: the link works once, and a page that confirmed by itself would
// be spent by React's development double-run or by anything that previews links.
const ConfirmEmailPage = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state) => state.auth);
    const [token] = useState(() => readLinkToken(window.location.hash));
    const [phase, setPhase] = useState('ready');
    const [error, setError] = useState('');

    useEffect(() => { clearLinkFragment(); }, []);

    const confirm = async () => {
        setPhase('working');
        try {
            await axiosClient.post('/auth/email/confirm', { token });
            setPhase('done');
            if (user) dispatch(fetchProfile());
        } catch (err) {
            setPhase('failed');
            setError(extractErrorCode(err) === 'INVALID_OR_EXPIRED_TOKEN'
                ? 'This link is invalid or has expired. Ask for the change again from your profile.'
                : extractErrorMessage(err));
        }
    };

    const onward = user
        ? <Link to="/dashboard/profile">Back to your profile</Link>
        : <Link to="/login">Sign in</Link>;

    return (
        <AuthLayout>
            <h2>Confirm your email address</h2>
            {!token && <p className="auth-subtitle">This link is incomplete.</p>}
            {token && (phase === 'ready' || phase === 'working') && (
                <button className="btn btn-primary btn-block" type="button" onClick={confirm} disabled={phase === 'working'}>
                    {phase === 'working' ? <span className="spinner" /> : 'Confirm new email address'}
                </button>
            )}
            {phase === 'done' && <p className="auth-subtitle" role="status">Your email address has been changed.</p>}
            {phase === 'failed' && <div className="form-error-banner">{error}</div>}
            {(phase === 'done' || phase === 'failed' || !token) && <div className="auth-switch">{onward}</div>}
        </AuthLayout>
    );
};

export default ConfirmEmailPage;
