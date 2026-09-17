import {} from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import ccirLogo from '../assets/images/CCIR LOGO.svg';

const MobileHeader = ({ onMenuClick }) => {
    return (
        <header className="mobile-header">
            <Link to="/dashboard" className="mobile-header-brand">
                <img src={ccirLogo} alt="" />
                CCIR System
            </Link>
            <span className="mobile-header-spacer" />
            <button type="button" className="hamburger-btn" onClick={onMenuClick} aria-label="Open menu">
                <Menu size={28} />
            </button>
        </header>
    );
};

export default MobileHeader;
