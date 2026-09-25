import { Link } from 'react-router';
import AuthLayout from '../../layouts/AuthLayout';

const AccountDeletedPage = () => (
    <AuthLayout>
        <h2>Your account has been deleted</h2>
        <p className="auth-subtitle">
            Your account is closed and you have been signed out. Reports stay with the agencies; reports you filed no longer show your name.
        </p>
        <div className="auth-switch"><Link to="/signup">Create a new account</Link></div>
    </AuthLayout>
);

export default AccountDeletedPage;
