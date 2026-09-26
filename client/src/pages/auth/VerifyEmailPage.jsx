import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import AuthLayout from '../../layouts/AuthLayout';
import VerifyEmailBanner from '../../components/account/VerifyEmailBanner';
import axiosClient, { extractErrorCode, extractErrorMessage } from '../../api/axiosClient';
import { clearLinkFragment, readLinkToken } from '../../routes/linkToken';
import { fetchProfile } from '../../slices/authSlice';

// Verifies on a click, not on load: the link works once, and a page that verified by itself would
// be spent by React's development double-run or by anything that previews links.
const VerifyEmailPage = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state) => state.auth);
    const [token] = useState(() => readLinkToken(window.location.hash));
    const [phase, setPhase] = useState('ready');
    const [error, setError] = useState('');
    const [expired, setExpired] = useState(false);

    useEffect(() => { clearLinkFragment(); }, []);

    const verify = async () => {
        setPhase('working');
        try {
            await axiosClient.post('/auth/email/verify', { token });
            setPhase('done');
            if (user) dispatch(fetchProfile());
        } catch (err) {
            setPhase('failed');
            const isExpired = extractErrorCode(err) === 'INVALID_OR_EXPIRED_TOKEN';
            setExpired(isExpired);
            setError(isExpired ? 'This link is invalid or has expired.' : extractErrorMessage(err));
        }
    };

    const onward = user
        ? <Link to="/dashboard/report">Report an issue</Link>
        : <Link to="/login">Sign in</Link>;

    return (
        <AuthLayout>
            <h2>Verify your email address</h2>
            {!token && <p className="auth-subtitle">This link is incomplete.</p>}
            {token && (phase === 'ready' || phase === 'working') && (
                <button className="btn btn-primary btn-block" type="button" onClick={verify} disabled={phase === 'working'}>
                    {phase === 'working' ? <span className="spinner" /> : 'Verify my email address'}
                </button>
            )}
            {phase === 'done' && <p className="auth-subtitle" role="status">Your email address is verified. You can now report issues.</p>}
            {phase === 'failed' && <div className="form-error-banner">{error}</div>}
            {phase === 'failed' && expired && (user
                ? <VerifyEmailBanner variant="panel" />
                : <div className="auth-switch"><Link to="/login">Sign in to send a new link</Link></div>)}
            {(phase === 'done' || (phase === 'failed' && !expired) || !token) && <div className="auth-switch">{onward}</div>}
        </AuthLayout>
    );
};

export default VerifyEmailPage;
