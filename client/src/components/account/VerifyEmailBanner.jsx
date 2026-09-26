import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import axiosClient, { extractErrorCode, extractErrorMessage } from '../../api/axiosClient';
import { fetchProfile } from '../../slices/authSlice';

// Shown to email-and-password accounts until they open the link sent at sign-up: across the top of
// the dashboard, or as a panel where the page itself (reporting) waits for it.
const VerifyEmailBanner = ({ variant = 'banner' }) => {
    const dispatch = useDispatch();
    const user = useSelector((state) => state.auth.user);
    const [phase, setPhase] = useState('idle');
    const [error, setError] = useState('');

    if (!user || user.emailVerified !== false) return null;

    const resend = async () => {
        setPhase('sending');
        try {
            await axiosClient.post('/users/profile/verification-email');
            setPhase('sent');
        } catch (err) {
            if (extractErrorCode(err) === 'ALREADY_VERIFIED') {
                // Verified in another tab or device: refreshing the account removes the banner.
                dispatch(fetchProfile());
                return;
            }
            setError(extractErrorMessage(err));
            setPhase('failed');
        }
    };

    return (
        <section className={variant === 'panel' ? 'verify-panel' : 'verify-banner'} aria-label="Email verification">
            <p>Verify your email to report issues. We sent a link to <strong>{user.email}</strong>.</p>
            <button className="btn btn-outline" type="button" onClick={resend} disabled={phase === 'sending'}>
                {phase === 'sending' ? <span className="spinner" /> : 'Resend link'}
            </button>
            {phase === 'sent' && <p role="status">We sent a new link to {user.email}.</p>}
            {phase === 'failed' && <p role="alert">{error}</p>}
        </section>
    );
};

export default VerifyEmailBanner;
