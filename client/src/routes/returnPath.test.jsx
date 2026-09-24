import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import ProtectedRoute from './ProtectedRoute';
import PublicRoute from './PublicRoute';
import { returnPath } from './returnPath';

let auth;
vi.mock('react-redux', () => ({ useSelector: (select) => select({ auth }) }));

const Where = () => {
    const location = useLocation();
    return <output aria-label="where">{`${location.pathname}${location.search}|${location.state?.from ?? ''}`}</output>;
};

const renderAt = (entry) => render(
    <MemoryRouter initialEntries={[entry]}>
        <Routes>
            <Route element={<PublicRoute />}><Route path="/login" element={<Where />} /></Route>
            <Route element={<ProtectedRoute />}><Route path="/dashboard/*" element={<Where />} /></Route>
        </Routes>
    </MemoryRouter>,
);

describe('returning to the page that asked for sign-in', () => {
    it('sends a signed-out visitor to sign in, remembering the page they asked for', () => {
        auth = { user: null, authChecked: true };
        renderAt('/dashboard/reports/abc?tab=1');
        expect(screen.getByLabelText('where')).toHaveTextContent('/login|/dashboard/reports/abc?tab=1');
    });

    it('takes a newly signed-in user back to that page', () => {
        auth = { user: { _id: 'u1' }, authChecked: true };
        renderAt({ pathname: '/login', state: { from: '/dashboard/reports/abc?tab=1' } });
        expect(screen.getByLabelText('where')).toHaveTextContent('/dashboard/reports/abc?tab=1|');
    });

    it('goes to the dashboard when no page was asked for', () => {
        auth = { user: { _id: 'u1' }, authChecked: true };
        renderAt('/login');
        expect(screen.getByLabelText('where')).toHaveTextContent('/dashboard|');
    });

    it.each([undefined, 'https://evil.example', '//evil.example', '/login', 42])('never returns anywhere outside the dashboard (%s)', (from) => {
        expect(returnPath({ from })).toBe('/dashboard');
    });
});
