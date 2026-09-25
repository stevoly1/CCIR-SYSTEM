import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import toast from 'react-hot-toast';
import SignupPage from './SignupPage';

const state = { auth: { status: 'idle', error: null } };
const dispatch = vi.fn();
const navigate = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-router', async (original) => ({ ...(await original()), useNavigate: () => navigate }));
vi.mock('../../slices/authSlice', () => {
  const signup = Object.assign((args) => ({ type: 'signup', args }), { fulfilled: { match: (a) => a.type === 'signup/fulfilled' } });
  return { signup, clearAuthError: () => ({ type: 'clear' }) };
});

const renderPage = () => render(<MemoryRouter><SignupPage /></MemoryRouter>);
const fill = async (user, { name = 'Ada Lovelace', email = 'ada@example.test', password = 'Analytical-1' } = {}) => {
  await user.type(screen.getByLabelText('Full name'), name);
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
};

describe('SignupPage', () => {
  beforeEach(() => { dispatch.mockReset(); navigate.mockReset(); state.auth = { status: 'idle', error: null }; });

  it('submits the name, email and password as typed, then goes to the dashboard', async () => {
    dispatch.mockImplementation(async (action) => (action.type === 'signup' ? { type: 'signup/fulfilled' } : action));
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'signup', args: { name: 'Ada Lovelace', email: 'ada@example.test', password: 'Analytical-1' } });
    expect(toast.success).toHaveBeenCalledWith('Account created!');
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('stays on the page when the server rejects the sign-up', async () => {
    dispatch.mockImplementation(async (action) => (action.type === 'signup' ? { type: 'signup/rejected' } : action));
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the server error message from the store', () => {
    state.auth = { status: 'failed', error: 'An account with this email already exists' };
    renderPage();
    expect(screen.getByText('An account with this email already exists')).toBeInTheDocument();
  });

  // The browser enforces these attributes before submitting (jsdom does not implement minLength,
  // so journey J6 proves the real-browser refusal); the server re-validates regardless.
  it('declares the fields the browser must require, including an eight-character password minimum', () => {
    renderPage();
    expect(screen.getByLabelText('Full name')).toBeRequired();
    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toBeRequired();
    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '8');
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', 'At least 8 characters');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('links to the login page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});
