import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import toast from 'react-hot-toast';
import LoginPage from './LoginPage';

const state = { auth: { status: 'idle', error: null } };
const dispatch = vi.fn();
const navigate = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-router', async (original) => ({ ...(await original()), useNavigate: () => navigate }));
vi.mock('../../slices/authSlice', () => {
  const login = Object.assign((args) => ({ type: 'login', args }), { fulfilled: { match: (a) => a.type === 'login/fulfilled' } });
  return { login, clearAuthError: () => ({ type: 'clear' }) };
});

const Search = () => <output aria-label="search">{useLocation().search}</output>;
const renderPage = (entry = '/login') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/login" element={<><LoginPage /><Search /></>} /></Routes>
  </MemoryRouter>,
);

describe('LoginPage', () => {
  beforeEach(() => { dispatch.mockReset(); navigate.mockReset(); state.auth = { status: 'idle', error: null }; });

  it('logs in with the typed credentials and goes to the dashboard', async () => {
    dispatch.mockImplementation(async (action) => (action.type === 'login' ? { type: 'login/fulfilled' } : action));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'citizen@example.test');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'login', args: { email: 'citizen@example.test', password: 'Correct-horse-1' } });
    expect(toast.success).toHaveBeenCalledWith('Welcome back!');
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('goes back to the page that asked for sign-in', async () => {
    dispatch.mockImplementation(async (action) => (action.type === 'login' ? { type: 'login/fulfilled' } : action));
    const user = userEvent.setup();
    renderPage({ pathname: '/login', state: { from: '/dashboard/reports/abc' } });
    await user.type(screen.getByLabelText('Email'), 'citizen@example.test');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(navigate).toHaveBeenCalledWith('/dashboard/reports/abc', { replace: true });
  });

  it('stays on the page when the server rejects the login', async () => {
    dispatch.mockImplementation(async (action) => (action.type === 'login' ? { type: 'login/rejected' } : action));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'citizen@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the server error message from the store', () => {
    state.auth = { status: 'failed', error: 'Invalid email or password' };
    renderPage();
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
  });

  it('disables the button while a login is in flight', () => {
    state.auth = { status: 'loading', error: null };
    renderPage();
    expect(screen.getByRole('button', { name: '' })).toBeDisabled();
  });

  it('offers Google sign-in and a link to sign up', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', expect.stringMatching(/\/auth\/google$/));
    expect(screen.getByRole('link', { name: /Sign up/i })).toHaveAttribute('href', '/signup');
  });

  it('sends Google sign-in back to the page that asked for it', () => {
    renderPage({ pathname: '/login', state: { from: '/dashboard/reports/abc' } });
    expect(screen.getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', expect.stringMatching(/\/auth\/google\?returnTo=%2Fdashboard%2Freports%2Fabc$/));
  });

  it('links to password recovery', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
  });

  it('reports a failed Google sign-in once and clears it from the address', () => {
    toast.error.mockClear();
    // StrictMode runs the effect twice in development; one toast id makes the repeat a no-op.
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/login?error=google_auth_failed']}>
          <Routes><Route path="/login" element={<><LoginPage /><Search /></>} /></Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(toast.error).toHaveBeenCalledWith('Google sign-in failed. Please try again.', { id: 'google-auth-failed' });
    expect(toast.error.mock.calls.every(([, options]) => options?.id === 'google-auth-failed')).toBe(true);
    expect(screen.getByLabelText('search')).toHaveTextContent(/^$/);
  });
});
