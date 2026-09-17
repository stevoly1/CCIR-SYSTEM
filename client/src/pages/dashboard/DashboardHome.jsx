import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { PlusCircle, ListChecks, CheckCircle2 } from 'lucide-react';
import Topbar from '../../components/Topbar';
import QuickActionCard from '../../components/QuickActionCard';
import ComplaintCard from '../../components/ComplaintCard';
import { fetchComplaints } from '../../slices/complaintSlice';

const DashboardHome = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state) => state.auth);
    const { items, listStatus } = useSelector((state) => state.complaints);
    const isStaff = user?.role === 'admin' || user?.role === 'agency';

    useEffect(() => {
        dispatch(fetchComplaints({ limit: 5 }));
    }, [dispatch]);

    const firstName = user?.name?.split(' ')[0];

    return (
        <div>
            <Topbar title={`Hello, ${firstName} \u{1F44B}`} subtitle="Here's what's happening with civic reports today." />

            <div className="quick-actions">
                <QuickActionCard
                    variant="primary"
                    icon={<PlusCircle size={20} />}
                    title="Report an Issue"
                    description="Tell us about a pothole, leak, or outage in your area"
                    to="/dashboard/report"
                />
                <QuickActionCard
                    variant="pink"
                    icon={<ListChecks size={20} />}
                    title={isStaff ? 'All Reports' : 'My Reports'}
                    description={isStaff ? 'Review and manage every submitted report' : 'Track the status of everything you reported'}
                    to="/dashboard/reports"
                />
                <QuickActionCard
                    variant="mint"
                    icon={<CheckCircle2 size={20} />}
                    title="Resolved Reports"
                    description="See issues that have already been fixed"
                    to="/dashboard/reports?status=RESOLVED"
                />
            </div>

            <div className="section-header">
                <h2>Recent reports</h2>
                <Link to="/dashboard/reports">View all</Link>
            </div>

            {listStatus === 'loading' && <div className="empty-state">Loading reports…</div>}

            {listStatus !== 'loading' && items.length === 0 && (
                <div className="empty-state">
                    <h3>No reports yet</h3>
                    <p>Once issues are reported, they'll show up here.</p>
                </div>
            )}

            <div className="card-list">
                {items.map((complaint) => (
                    <ComplaintCard key={complaint._id} complaint={complaint} />
                ))}
            </div>
        </div>
    );
};

export default DashboardHome;
