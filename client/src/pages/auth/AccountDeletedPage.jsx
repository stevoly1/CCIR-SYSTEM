import { Link } from 'react-router';
import AuthLayout from '../../layouts/AuthLayout';

const AccountDeletedPage = () => (
    <AuthLayout>
        <h2>Your account has been deleted</h2>
        <p className="auth-subtitle">
            Your details have been removed and you have been signed out. Reports you filed stay with the agencies, without your name.
        </p>
        <div className="auth-switch"><Link to="/signup">Create a new account</Link></div>
    </AuthLayout>
);

export default AccountDeletedPage;
