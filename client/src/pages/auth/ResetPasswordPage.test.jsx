import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import ResetPasswordPage from './ResetPasswordPage';

vi.mock('../../layouts/AuthLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
  extractErrorCode: (error) => error?.response?.data?.error?.code,
}));

const TOKEN = 'a'.repeat(43);
const renderAt = (hash) => {
  window.history.replaceState(null, '', `/reset-password${hash}`);
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>sign-in page</p>} />
        <Route path="/forgot-password" element={<p>forgot page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};
const fill = async (user, password, repeat = password) => {
  await user.type(screen.getByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Repeat new password'), repeat);
  await user.click(screen.getByRole('button', { name: 'Set new password' }));
};

describe('ResetPasswordPage', () => {
  beforeEach(() => { axiosClient.post.mockReset(); });

  it('removes the token from the address bar and sends it with the new password', async () => {
    axiosClient.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    expect(window.location.hash).toBe('');
    await fill(user, 'Brand-new-pass');
    expect(axiosClient.post).toHaveBeenCalledWith('/auth/password/reset', { token: TOKEN, password: 'Brand-new-pass' });
    expect(toast.success).toHaveBeenCalledWith('Password reset. Sign in with your new password.');
    expect(await screen.findByText('sign-in page')).toBeInTheDocument();
  });

  it('asks for 8 characters and matching passwords before calling the API', async () => {
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    expect(screen.getByLabelText('New password')).toHaveAttribute('minLength', '8');
    await fill(user, 'Brand-new-pass', 'Different-pass');
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  it('offers a new link when this one is invalid or expired', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'INVALID_OR_EXPIRED_TOKEN', message: 'expired' } } } });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    await fill(user, 'Brand-new-pass');
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('shows the server reason for other errors', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { code: 'PASSWORD_REJECTED', message: 'Password must not be your email address' } } } });
    const user = userEvent.setup();
    renderAt(`#token=${TOKEN}`);
    await fill(user, 'ada@example.test');
    expect(await screen.findByText('Password must not be your email address')).toBeInTheDocument();
  });

  it('explains a link without a token', () => {
    renderAt('');
    expect(screen.getByText('This link is incomplete.')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});
