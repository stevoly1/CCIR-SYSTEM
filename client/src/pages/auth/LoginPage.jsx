import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from '../../layouts/AuthLayout';
import GoogleButton from '../../components/GoogleButton';
import { login, clearAuthError } from '../../slices/authSlice';

const LoginPage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { status, error } = useSelector((state) => state.auth);
    const [form, setForm] = useState({ email: '', password: '' });
    const [searchParams, setSearchParams] = useSearchParams();

    useEffect(() => {
        if (searchParams.get('error') === 'google_auth_failed') {
            toast.error('Google sign-in failed. Please try again.');
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        dispatch(clearAuthError());
        const result = await dispatch(login(form));
        if (login.fulfilled.match(result)) {
            toast.success('Welcome back!');
            navigate('/dashboard');
        }
    };

    return (
        <AuthLayout>
            <h2>Welcome back</h2>
            <p className="auth-subtitle">Log in to track and manage your civic reports.</p>

            <GoogleButton label="Continue with Google" />
            <div className="auth-divider">or</div>

            {error && <div className="form-error-banner">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="field">
                    <label htmlFor="email">Email</label>
                    <input id="email" name="email" type="email" placeholder="you@example.com" value={form.email} onChange={handleChange} required />
                </div>
                <div className="field">
                    <label htmlFor="password">Password</label>
                    <input id="password" name="password" type="password" placeholder="••••••••" value={form.password} onChange={handleChange} required />
                </div>

                <button className="btn btn-primary btn-block" type="submit" disabled={status === 'loading'}>
                    {status === 'loading' ? <span className="spinner" /> : 'Log in'}
                </button>
            </form>

            <div className="auth-switch">
                Don't have an account?
                <Link to="/signup" style={{ color: 'var(--color-primary)', fontWeight: 700, marginLeft: 4 }}>Sign up</Link>
            </div>
        </AuthLayout>
    );
};

export default LoginPage;
