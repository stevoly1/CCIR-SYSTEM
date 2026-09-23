import { useSelector } from 'react-redux';
import { Navigate, Outlet } from 'react-router';

const PublicRoute = () => {
    const { user, authChecked } = useSelector((state) => state.auth);

    if (!authChecked) {
        return <div className="page-loading"><div className="spinner spinner-dark" /></div>;
    }

    if (user) {
        return <Navigate to="/dashboard" replace />;
    }

    return <Outlet />;
};

export default PublicRoute;
