import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import toast from 'react-hot-toast';
import axiosClient from '../../api/axiosClient';
import JobsPage from './JobsPage';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/Topbar', () => ({ default: ({ title }) => <h2>{title}</h2> }));
vi.mock('../../api/axiosClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  extractErrorMessage: (error) => error?.response?.data?.error?.message || 'Something went wrong',
}));

const summary = { queues: { email: { PENDING: 2, QUEUED: 1, FAILED: 1, DONE: 40, DISMISSED: 0 } }, oldestPendingSeconds: 95, workerLastSeenSeconds: 12 };
const failed = {
  id: 'j1', queue: 'email', type: 'email_change_notice', state: 'FAILED', attempts: 8, lastErrorCode: 'PROVIDER_DOWN',
  lastErrorAt: '2026-09-25T10:00:00.000Z', createdAt: '2026-09-25T09:00:00.000Z', subject: { kind: 'account', id: 'u1', label: 'Ada Example' },
};
const reportJob = { ...failed, id: 'j2', type: 'status_update', subject: { kind: 'report', id: 'c1', label: 'CCIR-7Q2M4K9D' } };
const listOf = (jobs, pages = 1) => ({ jobs, pagination: { page: 1, pages, total: jobs.length, limit: 20 } });

const renderPage = () => render(<MemoryRouter><JobsPage /></MemoryRouter>);
const serve = (summaryData, listData) => axiosClient.get.mockImplementation((url) => Promise.resolve({ data: url === '/admin/jobs/summary' ? summaryData : listData }));

describe('JobsPage', () => {
  beforeEach(() => {
    axiosClient.get.mockReset();
    serve(summary, listOf([failed, reportJob]));
    axiosClient.post.mockReset().mockResolvedValue({ data: {} });
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('summarises the queue and lists failed jobs in plain words', async () => {
    renderPage();
    expect(await screen.findByText('Ada Example')).toBeInTheDocument();
    expect(axiosClient.get).toHaveBeenCalledWith('/admin/jobs', { params: { state: 'FAILED', queue: 'email', page: 1 } });
    expect(within(screen.getByText('Waiting').parentElement).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByText('Oldest waiting').parentElement).getByText('95 s')).toBeInTheDocument();
    expect(screen.getByText('Worker last seen 12 s ago')).toBeInTheDocument();
    const row = screen.getByText('Ada Example').closest('tr');
    expect(within(row).getByText('Email change notice')).toBeInTheDocument();
    expect(within(row).getByText('Email provider unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CCIR-7Q2M4K9D' })).toHaveAttribute('href', '/dashboard/reports/c1');
  });

  it('says when no worker is running, and when nothing failed', async () => {
    serve({ queues: { email: { ...summary.queues.email, FAILED: 0 } }, oldestPendingSeconds: null, workerLastSeenSeconds: null }, listOf([], 0));
    renderPage();
    expect(await screen.findByText('No worker is running: emails wait until one starts.')).toBeInTheDocument();
    expect(screen.getByText('No failed jobs.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry all failed' })).toBeDisabled();
  });

  it('retries one job and reloads', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('Ada Example')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Retry' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/admin/jobs/j1/retry');
    expect(toast.success).toHaveBeenCalledWith('Queued again');
    expect(axiosClient.get).toHaveBeenCalledTimes(4);
  });

  it('dismisses a job only with a reason', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('Ada Example')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Dismiss' }));
    const dialog = screen.getByRole('dialog', { name: 'Dismiss failed job' });
    expect(within(dialog).getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason'), 'ok');
    expect(within(dialog).getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason'), ' then: address no longer exists');
    await user.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/admin/jobs/j1/dismiss', { reason: 'ok then: address no longer exists' });
    expect(toast.success).toHaveBeenCalledWith('Dismissed');
  });

  it('retries every failed job, and shows a refusal', async () => {
    axiosClient.post.mockResolvedValueOnce({ data: { retried: 2, skipped: 0 } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Example');
    await user.click(screen.getByRole('button', { name: 'Retry all failed' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/admin/jobs/retry-failed', { queue: 'email' });
    expect(toast.success).toHaveBeenCalledWith('2 jobs queued again');

    axiosClient.post.mockRejectedValueOnce({ response: { data: { error: { message: 'This job can no longer be retried; a newer request replaced it' } } } });
    await user.click(within(screen.getByText('Ada Example').closest('tr')).getByRole('button', { name: 'Retry' }));
    expect(toast.error).toHaveBeenCalledWith('This job can no longer be retried; a newer request replaced it');
  });

  it('counts skipped jobs when some could not be retried', async () => {
    axiosClient.post.mockResolvedValueOnce({ data: { retried: 1, skipped: 1 } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Example');
    await user.click(screen.getByRole('button', { name: 'Retry all failed' }));
    expect(toast.success).toHaveBeenCalledWith('1 job queued again; 1 could not be retried');
  });

  it('pages through failed jobs', async () => {
    serve(summary, { ...listOf([failed], 2), pagination: { page: 1, pages: 2, total: 21, limit: 20 } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Example');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(axiosClient.get).toHaveBeenCalledWith('/admin/jobs', { params: { state: 'FAILED', queue: 'email', page: 2 } });
  });
});
