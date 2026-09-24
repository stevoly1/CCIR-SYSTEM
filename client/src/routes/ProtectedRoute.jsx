import { useSelector } from 'react-redux';
import { Navigate, Outlet, useLocation } from 'react-router';

const ProtectedRoute = () => {
    const { user, authChecked } = useSelector((state) => state.auth);
    const location = useLocation();

    if (!authChecked) {
        return <div className="page-loading"><div className="spinner spinner-dark" /></div>;
    }

    if (!user) {
        // Remember the page, so signing in (for example from an emailed report link) returns to it.
        return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
    }

    return <Outlet />;
};

export default ProtectedRoute;
