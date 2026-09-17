import {} from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import ccirLogo from '../assets/images/CCIR LOGO.svg';
import ccirDisplay from '../assets/images/CCIR DISPLAY.jpg';

const AuthLayout = ({ children }) => {
    return (
        <div className="auth-screen">
            <div className="auth-hero">
                <div className="auth-hero-brand">
                    <span className="brand-mark"><img src={ccirLogo} alt="" /></span>
                    CCIR System
                </div>

                <h1>Report civic issues. Get them fixed.</h1>
                <p>
                    Potholes, broken streetlights, blocked drains, or piled up waste. Tell us what's wrong
                    and our AI sends it straight to the right local team.
                </p>

                <div className="auth-hero-illustration">
                    <img src={ccirDisplay} alt="" className="auth-hero-illustration-img" />
                </div>

                <div className="auth-hero-badges">
                    <div className="auth-hero-badge badge-2"><CheckCircle2 size={13} color="#1B8A5A" /> Report resolved</div>
                    <div className="auth-hero-badge badge-3"><Sparkles size={13} color="#5B3DE0" /> AI classified &middot; High priority</div>
                </div>
            </div>

            <div className="auth-panel">
                <div className="auth-panel-inner">{children}</div>
            </div>
        </div>
    );
};

export default AuthLayout;
