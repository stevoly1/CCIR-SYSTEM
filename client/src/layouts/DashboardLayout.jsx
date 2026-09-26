import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import Sidebar from '../components/Sidebar';
import MobileHeader from '../components/MobileHeader';
import VerifyEmailBanner from '../components/account/VerifyEmailBanner';

const DashboardLayout = () => {
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    const [prevPathname, setPrevPathname] = useState(location.pathname);

    if (location.pathname !== prevPathname) {
        setPrevPathname(location.pathname);
        setMenuOpen(false);
    }

    useEffect(() => {
        document.body.style.overflow = menuOpen ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [menuOpen]);

    return (
        <div className="app-shell">
            <MobileHeader onMenuClick={() => setMenuOpen(true)} />
            <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
            {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
            <main className="main-content">
                <VerifyEmailBanner />
                <Outlet />
            </main>
        </div>
    );
};

export default DashboardLayout;
