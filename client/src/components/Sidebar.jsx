import {} from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Home, PlusCircle, FileText, Users, Settings, LogOut, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../slices/authSlice';
import toast from 'react-hot-toast';
import ccirLogo from '../assets/images/CCIR LOGO.svg';

const Sidebar = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const isStaff = user?.role === 'admin' || user?.role === 'agency';

    const handleLogout = async () => {
        onClose?.();
        await dispatch(logout());
        toast.success('Logged out');
        navigate('/login');
    };

    const initials = (user?.name || '?')
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    return (
        <aside className={`sidebar${open ? ' open' : ''}`}>
            <div className="sidebar-brand">
                <Link to="/dashboard" className="sidebar-brand-link" onClick={onClose}>
                    <span className="brand-mark"><img src={ccirLogo} alt="" /></span>
                    CCIR System
                </Link>
                <button type="button" className="sidebar-close" onClick={onClose} aria-label="Close menu">
                    <X size={20} />
                </button>
            </div>

            <NavLink to="/dashboard/report" className="btn btn-primary btn-block sidebar-create" onClick={onClose}>
                <PlusCircle size={17} /> Report Issue
            </NavLink>

            <nav className="sidebar-nav">
                <NavLink to="/dashboard" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} onClick={onClose}>
                    <Home size={18} /> Home
                </NavLink>
                <NavLink to="/dashboard/reports" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} onClick={onClose}>
                    <FileText size={18} /> {isStaff ? 'All Reports' : 'My Reports'}
                </NavLink>
                {user?.role === 'admin' && (
                    <NavLink to="/dashboard/users" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} onClick={onClose}>
                        <Users size={18} /> Users
                    </NavLink>
                )}
                <NavLink to="/dashboard/profile" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} onClick={onClose}>
                    <Settings size={18} /> Profile
                </NavLink>
            </nav>

            <div className="sidebar-footer">
                <div className="sidebar-user">
                    <div className="avatar">
                        {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-initials">{initials}</span>}
                    </div>
                    <div className="sidebar-user-meta">
                        <div className="name">{user?.name}</div>
                        <div className="role">{user?.role}</div>
                    </div>
                </div>
                <button className="logout-btn" onClick={handleLogout}>
                    <LogOut size={16} /> Log out
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
