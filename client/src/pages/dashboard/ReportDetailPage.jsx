import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import Topbar from '../../components/Topbar';
import StatusBadge from '../../components/StatusBadge';
import PriorityBadge from '../../components/PriorityBadge';
import ComplaintSummary from '../../components/complaint/ComplaintSummary';
import ComplaintTimeline from '../../components/complaint/ComplaintTimeline';
import OwnerActionsPanel from '../../components/complaint/OwnerActionsPanel';
import ResponsibilityPanel from '../../components/complaint/ResponsibilityPanel';
import StaffActionsPanel from '../../components/complaint/StaffActionsPanel';
import AdminDeleteDialog from '../../components/complaint/AdminDeleteDialog';
import { fetchComplaint, clearCurrentComplaint } from '../../slices/complaintSlice';

// Composition only: every permission shown here comes from the server's presenter.
// A closed report nobody was assigned to will not be assigned, so it makes no such promise.
const CLOSED_STATUSES = ['RESOLVED', 'REJECTED', 'WITHDRAWN'];
const assignmentNote = (complaint) => {
    if (complaint.responsibility === 'ASSIGNED') return 'Assigned to agency staff';
    return CLOSED_STATUSES.includes(complaint.status) ? '' : 'Awaiting assignment';
};

const ReportDetailPage = () => {
    const { id } = useParams();
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { current, detailStatus } = useSelector((state) => state.complaints);
    const isStaff = user?.role === 'admin' || user?.role === 'agency';
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    useEffect(() => {
        dispatch(fetchComplaint(id));
        return () => dispatch(clearCurrentComplaint());
    }, [dispatch, id]);

    const reload = () => dispatch(fetchComplaint(id));

    if (!current && detailStatus === 'failed') {
        return <div className="empty-state">This report could not be loaded.</div>;
    }
    // Only a first load shows the placeholder; background refreshes keep the report
    // (and any panel state such as notices) on screen.
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
                    onConflict={() => { setConfirmingDelete(false); reload(); }}
                />
            )}

            <div className="report-detail-grid" style={{ display: 'grid', gridTemplateColumns: isStaff ? '1.6fr 1fr' : '1fr', gap: 24 }}>
                <div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <StatusBadge status={current.status} />
                        <PriorityBadge priority={current.priority} />
                    </div>

                    <ComplaintSummary complaint={current} staffView={isStaff} />

                    {!isStaff && assignmentNote(current) && <p className="meta">{assignmentNote(current)}</p>}

                    <div className="section-header" style={{ marginTop: 28 }}>
                        <h2>Timeline</h2>
                    </div>
                    <ComplaintTimeline entries={current.timeline} staffView={isStaff} />
                    {!isStaff && (
                        <OwnerActionsPanel complaint={current} onUpdated={reload} onConflict={reload} />
                    )}
                </div>

                {isStaff && (
                    <div>
                        <ResponsibilityPanel complaint={current} onUpdated={reload} onConflict={reload} />
                        <div className="section-header"><h2>Update report</h2></div>
                        <StaffActionsPanel key={current.version} complaint={current} onUpdated={reload} onConflict={reload} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportDetailPage;
