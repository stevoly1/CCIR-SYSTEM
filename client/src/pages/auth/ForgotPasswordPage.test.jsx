import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import axiosClient from '../../api/axiosClient';
import ForgotPasswordPage from './ForgotPasswordPage';

vi.mock('../../layouts/AuthLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../api/axiosClient', () => ({
  default: { post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

const renderPage = () => render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);

describe('ForgotPasswordPage', () => {
  beforeEach(() => { axiosClient.post.mockReset(); });

  it('sends the email and shows the same answer whatever the outcome', async () => {
    axiosClient.post.mockResolvedValue({ data: { msg: 'ok' } });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/auth/password/forgot', { email: 'ada@example.test' });
    expect(await screen.findByRole('status')).toHaveTextContent('If an account uses ada@example.test, we have sent it a link');
  });

  it('shows a throttle or validation error', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: { message: 'Too many requests, please try again later' } } } });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Too many requests, please try again later')).toBeInTheDocument();
  });

  it('links back to sign in', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });
});
