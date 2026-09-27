import { act, render, screen, waitFor, within } from '@testing-library/react';
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

const summary = { queues: { email: { PENDING: 2, QUEUED: 1, FAILED: 1, DONE: 40, DISMISSED: 0 }, ai: { PENDING: 1, QUEUED: 0, FAILED: 2, DONE: 10, DISMISSED: 0 } }, oldestPendingSeconds: 95, workerLastSeenSeconds: 12 };
const failed = {
  id: 'j1', queue: 'email', type: 'email_change_notice', state: 'FAILED', attempts: 8, lastErrorCode: 'PROVIDER_DOWN',
  lastErrorAt: '2026-09-25T10:00:00.000Z', createdAt: '2026-09-25T09:00:00.000Z', subject: { kind: 'account', id: 'u1', label: 'Ada Example' },
};
const reportJob = { ...failed, id: 'j2', type: 'status_update', subject: { kind: 'report', id: 'c1', label: 'CCIR-7Q2M4K9D' } };
const aiJob = { ...failed, id: 'j3', queue: 'ai', type: 'classify_report', lastErrorCode: 'REFUSED', subject: { kind: 'report', id: 'c2', label: 'CCIR-AB12CD34' } };
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

  it('switches between the email and AI queues', async () => {
    const user = userEvent.setup();
    renderPage();
    const tabs = await screen.findByRole('tablist', { name: 'Queues' });
    expect(within(tabs).getByRole('tab', { name: 'Email' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('Ada Example');
    serve(summary, listOf([aiJob]));
    await user.click(within(tabs).getByRole('tab', { name: 'AI' }));
    expect(axiosClient.get).toHaveBeenCalledWith('/admin/jobs', { params: { state: 'FAILED', queue: 'ai', page: 1 } });
    const row = (await screen.findByRole('link', { name: 'CCIR-AB12CD34' })).closest('tr');
    expect(within(row).getByText('Report classification')).toBeInTheDocument();
    expect(within(row).getByText('The AI declined the report')).toBeInTheDocument();
    expect(within(screen.getByText('Failed').parentElement).getByText('2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry all failed' }));
    expect(axiosClient.post).toHaveBeenCalledWith('/admin/jobs/retry-failed', { queue: 'ai' });
  });

  it('keeps the selected queue when an older list request finishes late', async () => {
    let finishEmail;
    const slowEmail = new Promise((resolve) => { finishEmail = resolve; });
    axiosClient.get.mockImplementation((url, options) => {
      if (url === '/admin/jobs/summary') return Promise.resolve({ data: summary });
      return options.params.queue === 'email' ? slowEmail : Promise.resolve({ data: listOf([aiJob]) });
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(axiosClient.get).toHaveBeenCalledWith('/admin/jobs', { params: { state: 'FAILED', queue: 'email', page: 1 } }));
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    expect(await screen.findByRole('link', { name: 'CCIR-AB12CD34' })).toBeInTheDocument();
    await act(async () => { finishEmail({ data: listOf([failed]) }); await slowEmail; });
    expect(screen.queryByText('Ada Example')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CCIR-AB12CD34' })).toBeInTheDocument();
  });

  it('uses AI failure wording and an AI dismissal message', async () => {
    const user = userEvent.setup();
    serve({ ...summary, workerLastSeenSeconds: null }, listOf([aiJob, { ...aiJob, id: 'j4', lastErrorCode: 'PROVIDER_DOWN' }, { ...aiJob, id: 'j5', lastErrorCode: 'NOT_CONFIGURED' }]));
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    expect(await screen.findByText('No worker is running: classifications wait until one starts.')).toBeInTheDocument();
    expect(screen.getByText('AI provider unavailable')).toBeInTheDocument();
    expect(screen.getByText('AI is not configured')).toBeInTheDocument();
    await user.click(within(screen.getByText('AI provider unavailable').closest('tr')).getByRole('button', { name: 'Dismiss' }));
    expect(within(screen.getByRole('dialog', { name: 'Dismiss failed job' })).getByText('Stop trying this report classification? It will not be classified.')).toBeInTheDocument();
  });
});
