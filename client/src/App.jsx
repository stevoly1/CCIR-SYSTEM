import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Toaster } from 'react-hot-toast';

import { fetchProfile } from './slices/authSlice';

import ProtectedRoute from './routes/ProtectedRoute';
import PublicRoute from './routes/PublicRoute';
import RoleRoute from './routes/RoleRoute';

import DashboardLayout from './layouts/DashboardLayout';

import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import DashboardHome from './pages/dashboard/DashboardHome';
import ReportIssuePage from './pages/dashboard/ReportIssuePage';
import ReportsListPage from './pages/dashboard/ReportsListPage';
import ReportDetailPage from './pages/dashboard/ReportDetailPage';
import ProfilePage from './pages/dashboard/ProfilePage';
import UsersPage from './pages/dashboard/UsersPage';

const App = () => {
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(fetchProfile());
    }, [dispatch]);

    return (
        <>
            <Toaster position="top-center" />
            <Routes>
                <Route element={<PublicRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                </Route>

                <Route element={<ProtectedRoute />}>
                    <Route path="/dashboard" element={<DashboardLayout />}>
                        <Route index element={<DashboardHome />} />
                        <Route path="report" element={<ReportIssuePage />} />
                        <Route path="reports" element={<ReportsListPage />} />
                        <Route path="reports/:id" element={<ReportDetailPage />} />
                        <Route path="profile" element={<ProfilePage />} />
                        <Route element={<RoleRoute roles={['admin']} />}>
                            <Route path="users" element={<UsersPage />} />
                        </Route>
                    </Route>
                </Route>

                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
        </>
    );
};

export default App;
