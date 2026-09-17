import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import AuthLayout from '../../layouts/AuthLayout';
import GoogleButton from '../../components/GoogleButton';
import { signup, clearAuthError } from '../../slices/authSlice';

const SignupPage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { status, error } = useSelector((state) => state.auth);
    const [form, setForm] = useState({ name: '', email: '', password: '' });

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        dispatch(clearAuthError());
        const result = await dispatch(signup(form));
        if (signup.fulfilled.match(result)) {
            toast.success('Account created!');
            navigate('/dashboard');
        }
    };

    return (
        <AuthLayout>
            <h2>Create your account</h2>
            <p className="auth-subtitle">Join CCIR System to start reporting issues in your community.</p>

            <GoogleButton label="Continue with Google" />
            <div className="auth-divider">or</div>

            {error && <div className="form-error-banner">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="field">
                    <label htmlFor="name">Full name</label>
                    <input id="name" name="name" type="text" placeholder="Ada Lovelace" value={form.name} onChange={handleChange} required />
                </div>
                <div className="field">
                    <label htmlFor="email">Email</label>
                    <input id="email" name="email" type="email" placeholder="you@example.com" value={form.email} onChange={handleChange} required />
                </div>
                <div className="field">
                    <label htmlFor="password">Password</label>
                    <input id="password" name="password" type="password" placeholder="At least 6 characters" value={form.password} onChange={handleChange} minLength={6} required />
                </div>

                <button className="btn btn-primary btn-block" type="submit" disabled={status === 'loading'}>
                    {status === 'loading' ? <span className="spinner" /> : 'Create account'}
                </button>
            </form>

            <div className="auth-switch">
                Already have an account?
                <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 700, marginLeft: 4 }}>Log in</Link>
            </div>
        </AuthLayout>
    );
};

export default SignupPage;
