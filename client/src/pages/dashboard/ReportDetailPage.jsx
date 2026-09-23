import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, MapPin, Sparkles } from 'lucide-react';
import Topbar from '../../components/Topbar';
import StatusBadge from '../../components/StatusBadge';
import PriorityBadge from '../../components/PriorityBadge';
import OwnerActionsPanel from '../../components/complaint/OwnerActionsPanel';
import AdminDeleteDialog from '../../components/complaint/AdminDeleteDialog';
import ComplaintTimeline from '../../components/complaint/ComplaintTimeline';
import { categoryLabel } from '../../components/complaint/categoryLabel';
import {
    fetchComplaint,
    clearCurrentComplaint,
    updateComplaintStatus,
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

    const [statusForm, setStatusForm] = useState({ status: '', priority: '', publicNote: '' });
    const [updating, setUpdating] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    useEffect(() => {
        dispatch(fetchComplaint(id));
        return () => dispatch(clearCurrentComplaint());
    }, [dispatch, id]);

    useEffect(() => {
        if (current) {
            // The fetched complaint is the external source for this editable draft.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStatusForm({ status: current.status, priority: current.priority, publicNote: '' });
        }
    }, [current]);

    const handleUpdateStatus = async (e) => {
        e.preventDefault();
        setUpdating(true);
        const result = await dispatch(updateComplaintStatus({ id, ...statusForm, expectedVersion: current.version }));
        setUpdating(false);
        if (updateComplaintStatus.fulfilled.match(result)) {
            toast.success('Report updated');
        } else {
            toast.error(result.payload || 'Failed to update report');
        }
    };

    const reload = () => dispatch(fetchComplaint(id));

    // Only a first load shows the placeholder; background refreshes keep the report
    // (and any panel state such as notices) on screen.
    if (!current && detailStatus === 'failed') {
        return <div className="empty-state">This report could not be loaded.</div>;
    }
    if (!current) {
        return <div className="empty-state">Loading report…</div>;
    }


    return (
        <div>
            <button className="btn btn-outline" onClick={() => navigate(-1)} style={{ marginBottom: 20, padding: '8px 16px' }}>
                <ArrowLeft size={16} /> Back
            </button>

            <Topbar
                title={current.referenceCode}
                subtitle={isStaff ? `Reported by ${current.reporter?.displayName}` : 'Your report'}
                actions={current.canDelete ? (
                    <button type="button" className="btn btn-outline" onClick={() => setConfirmingDelete(true)}>
                        Delete permanently
                    </button>
                ) : null}
            />

            {confirmingDelete && (
                <AdminDeleteDialog
                    complaint={current}
                    onClose={() => setConfirmingDelete(false)}
                    onDeleted={() => navigate('/dashboard/reports')}
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
                        <p>{categoryLabel(current.category)}</p>
                    </div>

                    <div className="field">
                        <label>Location</label>
                        <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <MapPin size={15} color="var(--color-text-muted)" style={{ flexShrink: 0 }} /> {current.address || 'No address recorded'}
                        </p>
                        {current.hasPrecisePosition && <span className="meta">Precise position recorded</span>}
                    </div>

                    {current.ai?.summary && (
                        <div className="field">
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Sparkles size={14} color="var(--color-accent-lavender-text)" /> AI summary
                            </label>
                            <p style={{ color: 'var(--color-text-muted)' }}>{current.ai.summary}</p>
                        </div>
                    )}

                    <div className="section-header" style={{ marginTop: 28 }}>
                        <h2>Timeline</h2>
                    </div>
                    <ComplaintTimeline entries={current.timeline} staffView={isStaff} />
                    {!isStaff && (
                        <OwnerActionsPanel
                            complaint={current}
                            onUpdated={reload}
                            onConflict={reload}
                        />
                    )}
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
                                <label htmlFor="note">Public note (visible to the reporter)</label>
                                <textarea id="note" rows={3} value={statusForm.publicNote} onChange={(e) => setStatusForm({ ...statusForm, publicNote: e.target.value })} placeholder="e.g. Crew dispatched, expected fix by Friday" />
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
