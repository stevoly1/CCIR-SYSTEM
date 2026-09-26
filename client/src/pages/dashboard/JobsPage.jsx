import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import Topbar from '../../components/Topbar';
import Pager from '../../components/Pager';
import ReasonDialog from '../../components/ReasonDialog';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';

const TYPE_LABELS = {
    report_filed: 'Report filed email',
    status_update: 'Status update email',
    password_reset_request: 'Password reset email',
    password_changed: 'Password changed email',
    email_change_notice: 'Email change notice',
    email_change_link: 'Email change link',
    verify_email: 'Verification email',
};
const ERROR_LABELS = {
    PROVIDER_DOWN: 'Email provider unavailable',
    RATE_LIMITED: 'Rate limited by the provider',
    REJECTED: 'Rejected by the provider',
    NOT_CONFIGURED: 'Email is not configured',
    RECIPIENT_CAPPED: 'Too many links to this address',
    TIMEOUT: 'Timed out',
    INTERNAL: 'Unexpected error',
};

const ago = (seconds) => (seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`);
const retriedMessage = ({ retried, skipped }) => {
    const done = `${retried} ${retried === 1 ? 'job' : 'jobs'} queued again`;
    return skipped ? `${done}; ${skipped} could not be retried` : done;
};

// Administrators see background work here: what waits, what failed, and why. Nothing personal
// beyond a report's reference or an account's name.
const JobsPage = () => {
    const [summary, setSummary] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, pages: 1 });
    const [dismissing, setDismissing] = useState(null);
    const [acting, setActing] = useState(false);

    const load = useCallback(async (page = 1) => {
        try {
            const [s, list] = await Promise.all([
                axiosClient.get('/admin/jobs/summary'),
                axiosClient.get('/admin/jobs', { params: { state: 'FAILED', queue: 'email', page } }),
            ]);
            setSummary(s.data);
            setJobs(list.data.jobs);
            setPagination(list.data.pagination);
        } catch (err) {
            toast.error(extractErrorMessage(err));
        }
    }, []);

    // Loads after the first render, as the other admin pages do.
    useEffect(() => {
        const timeoutId = setTimeout(() => { void load(); }, 0);
        return () => clearTimeout(timeoutId);
    }, [load]);

    const act = async (request, success) => {
        setActing(true);
        try {
            const { data } = await request();
            toast.success(typeof success === 'function' ? success(data) : success);
            setDismissing(null);
            await load(pagination.page);
        } catch (err) {
            toast.error(extractErrorMessage(err));
        } finally {
            setActing(false);
        }
    };

    const email = summary?.queues.email;
    return (
        <div>
            <Topbar title="Jobs" subtitle="Background work: emails waiting, and emails that could not be sent." />
            {summary && (
                <div className="jobs-summary">
                    <div className="jobs-stat"><span>Waiting</span><strong>{email.PENDING + email.QUEUED}</strong></div>
                    <div className="jobs-stat"><span>Failed</span><strong>{email.FAILED}</strong></div>
                    <div className="jobs-stat"><span>Oldest waiting</span><strong>{summary.oldestPendingSeconds === null ? 'None' : ago(summary.oldestPendingSeconds)}</strong></div>
                    <p className="jobs-worker">
                        {summary.workerLastSeenSeconds === null
                            ? 'No worker is running: emails wait until one starts.'
                            : `Worker last seen ${ago(summary.workerLastSeenSeconds)} ago`}
                    </p>
                </div>
            )}
            <div className="jobs-actions">
                <button
                    className="btn btn-outline"
                    type="button"
                    disabled={acting || !email?.FAILED}
                    onClick={() => act(() => axiosClient.post('/admin/jobs/retry-failed', { queue: 'email' }), retriedMessage)}
                >
                    Retry all failed
                </button>
            </div>
            {jobs.length === 0 ? <p>No failed jobs.</p> : (
                <div className="jobs-table-wrap">
                    <table className="jobs-table">
                        <thead>
                            <tr><th>Job</th><th>About</th><th>Tries</th><th>Reason</th><th>When</th><th><span className="visually-hidden">Actions</span></th></tr>
                        </thead>
                        <tbody>
                            {jobs.map((job) => (
                                <tr key={job.id}>
                                    <td>{TYPE_LABELS[job.type] ?? job.type}</td>
                                    <td>{job.subject.kind === 'report' && job.subject.id
                                        ? <Link to={`/dashboard/reports/${job.subject.id}`}>{job.subject.label}</Link>
                                        : job.subject.label}</td>
                                    <td>{job.attempts}</td>
                                    <td>{ERROR_LABELS[job.lastErrorCode] ?? job.lastErrorCode}</td>
                                    <td>{job.lastErrorAt ? new Date(job.lastErrorAt).toLocaleString() : ''}</td>
                                    <td className="jobs-row-actions">
                                        <button className="btn btn-outline" type="button" disabled={acting} onClick={() => act(() => axiosClient.post(`/admin/jobs/${job.id}/retry`), 'Queued again')}>Retry</button>
                                        <button className="btn btn-outline" type="button" disabled={acting} onClick={() => setDismissing(job)}>Dismiss</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <Pager page={pagination.page} pages={pagination.pages} onChange={(page) => void load(page)} label="Job pages" />
            {dismissing && (
                <ReasonDialog
                    title="Dismiss failed job"
                    message={`Stop trying this ${TYPE_LABELS[dismissing.type]?.toLowerCase() ?? 'job'}? It will not be sent.`}
                    confirmLabel="Dismiss"
                    reasonRequired
                    loading={acting}
                    onConfirm={(reason) => act(() => axiosClient.post(`/admin/jobs/${dismissing.id}/dismiss`, { reason }), 'Dismissed')}
                    onClose={() => setDismissing(null)}
                />
            )}
        </div>
    );
};

export default JobsPage;
