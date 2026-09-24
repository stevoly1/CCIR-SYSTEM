import { useSelector } from 'react-redux';
import { Navigate, Outlet, useLocation } from 'react-router';
import { returnPath } from './returnPath';

const PublicRoute = () => {
    const { user, authChecked } = useSelector((state) => state.auth);
    const location = useLocation();

    if (!authChecked) {
        return <div className="page-loading"><div className="spinner spinner-dark" /></div>;
    }

    if (user) {
        return <Navigate to={returnPath(location.state)} replace />;
    }

    return <Outlet />;
};

export default PublicRoute;
