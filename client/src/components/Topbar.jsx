import React from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Topbar = ({ title, subtitle, actions }) => {
    const navigate = useNavigate();

    return (
        <div className="topbar">
            <div className="topbar-heading">
                <h1>{title}</h1>
                {subtitle && <p style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>{subtitle}</p>}
            </div>
            <div className="topbar-actions">
                {actions}
                <button className="icon-btn" onClick={() => navigate('/dashboard/reports')} aria-label="Notifications">
                    <Bell size={18} />
                </button>
            </div>
        </div>
    );
};

export default Topbar;
