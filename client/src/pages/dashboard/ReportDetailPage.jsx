import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, MapPin, Sparkles, Trash2 } from 'lucide-react';
import Topbar from '../../components/Topbar';
import StatusBadge from '../../components/StatusBadge';
import PriorityBadge from '../../components/PriorityBadge';
import ConfirmModal from '../../components/ConfirmModal';
import {
    fetchComplaint,
    clearCurrentComplaint,
    updateComplaintStatus,
    deleteComplaint,
} from '../../slices/complaintSlice';

const STATUS_OPTIONS = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const ReportDetailPage = () => {
    const { id } = useParams();
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { current, detailStatus } = useSelector((state) => state.complaints);
    const isStaff = user?.role === 'admin' || user?.role === 'agency';

    const [statusForm, setStatusForm] = useState({ status: '', priority: '', note: '' });
    const [updating, setUpdating] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        dispatch(fetchComplaint(id));
        return () => dispatch(clearCurrentComplaint());
    }, [dispatch, id]);

    useEffect(() => {
        if (current) {
            setStatusForm({ status: current.status, priority: current.priority, note: '' });
        }
    }, [current]);

    const handleUpdateStatus = async (e) => {
        e.preventDefault();
        setUpdating(true);
        const result = await dispatch(updateComplaintStatus({ id, ...statusForm }));
        setUpdating(false);
        if (updateComplaintStatus.fulfilled.match(result)) {
            toast.success('Report updated');
        } else {
            toast.error(result.payload || 'Failed to update report');
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        const result = await dispatch(deleteComplaint(id));
        setDeleting(false);
        if (deleteComplaint.fulfilled.match(result)) {
            toast.success('Report deleted');
            navigate('/dashboard/reports');
        } else {
            toast.error(result.payload || 'Failed to delete report');
            setConfirmingDelete(false);
        }
    };

    if (detailStatus === 'loading' || !current) {
        return <div className="empty-state">Loading report…</div>;
    }

    const isOwner = current.reporter?._id === user?._id;
    const canDelete = isOwner || isStaff;

    return (
        <div>
            <button className="btn btn-outline" onClick={() => navigate(-1)} style={{ marginBottom: 20, padding: '8px 16px' }}>
                <ArrowLeft size={16} /> Back
            </button>

            <Topbar
                title={current.referenceCode}
                subtitle={`Reported by ${current.reporter?.name || 'a citizen'}`}
                actions={canDelete ? (
                    <button className="icon-btn" onClick={() => setConfirmingDelete(true)} aria-label="Delete report">
                        <Trash2 size={16} />
                    </button>
                ) : null}
            />

            {confirmingDelete && (
                <ConfirmModal
                    title="Delete report"
                    message="Delete this report? This cannot be undone."
                    confirmLabel="Delete"
                    loading={deleting}
                    onConfirm={handleDelete}
                    onClose={() => setConfirmingDelete(false)}
                />
            )}

            <div className="report-detail-grid" style={{ display: 'grid', gridTemplateColumns: isStaff ? '1.6fr 1fr' : '1fr', gap: 24 }}>
                <div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <StatusBadge status={current.status} />
                        <PriorityBadge priority={current.priority} />
                    </div>

                    {current.images?.length > 0 && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: current.images.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))',
                            gap: 8, marginBottom: 20,
                        }}>
                            {current.images.map((img) => (
                                <a key={img.publicId || img.url} href={img.url} target="_blank" rel="noreferrer">
                                    <img
                                        src={img.url}
                                        alt=""
                                        style={{
                                            width: '100%',
                                            height: current.images.length === 1 ? 320 : 140,
                                            objectFit: 'cover',
                                            borderRadius: 'var(--radius-md)',
                                            display: 'block',
                                        }}
                                    />
                                </a>
                            ))}
                        </div>
                    )}

                    <div className="field">
                        <label>Description</label>
                        <p style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 14 }}>
                            {current.description}
                        </p>
                    </div>

                    <div className="field">
                        <label>Category</label>
                        <p>{current.category?.name || 'Uncategorized'}</p>
                    </div>

                    {current.location?.address && (
                        <div className="field">
                            <label>Location</label>
                            <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MapPin size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} /> {current.location.address}
                            </p>
                        </div>
                    )}

                    {current.ai?.summary && (
                        <div className="field">
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Sparkles size={14} color="var(--color-accent-lavender-text)" /> AI summary
                            </label>
                            <p style={{ color: 'var(--color-text-muted)' }}>{current.ai.summary}</p>
                        </div>
                    )}

                    <div className="section-header" style={{ marginTop: 28 }}>
                        <h2>Status history</h2>
                    </div>
                    <div className="card-list">
                        {current.statusHistory?.slice().reverse().map((entry) => (
                            <div key={entry._id} className="complaint-card" style={{ alignItems: 'flex-start' }}>
                                <div className="complaint-info">
                                    <StatusBadge status={entry.status} />
                                    {entry.note && <p style={{ marginTop: 8 }}>{entry.note}</p>}
                                    <div className="meta" style={{ marginTop: 6 }}>
                                        {entry.changedBy?.name && <span>{entry.changedBy.name}</span>}
                                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {isStaff && (
                    <div>
                        <div className="section-header"><h2>Update report</h2></div>
                        <form onSubmit={handleUpdateStatus} style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 }}>
                            <div className="field">
                                <label htmlFor="status">Status</label>
                                <select id="status" value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
                                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="priority">Priority</label>
                                <select id="priority" value={statusForm.priority} onChange={(e) => setStatusForm({ ...statusForm, priority: e.target.value })}>
                                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="note">Note (optional)</label>
                                <textarea id="note" rows={3} value={statusForm.note} onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} placeholder="e.g. Crew dispatched, expected fix by Friday" />
                            </div>
                            <button className="btn btn-primary btn-block" type="submit" disabled={updating}>
                                {updating ? <span className="spinner" /> : 'Save update'}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportDetailPage;
