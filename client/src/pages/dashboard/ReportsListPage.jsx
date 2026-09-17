import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import Topbar from '../../components/Topbar';
import ComplaintCard from '../../components/ComplaintCard';
import { fetchComplaints } from '../../slices/complaintSlice';

const STATUS_FILTERS = [
    { label: 'All', value: '' },
    { label: 'Pending', value: 'PENDING' },
    { label: 'In Review', value: 'IN_REVIEW' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'Resolved', value: 'RESOLVED' },
    { label: 'Rejected', value: 'REJECTED' },
];

const ReportsListPage = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state) => state.auth);
    const { items, listStatus, pagination } = useSelector((state) => state.complaints);
    const [searchParams, setSearchParams] = useSearchParams();
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const isStaff = user?.role === 'admin' || user?.role === 'agency';

    const [searchInput, setSearchInput] = useState(search);
    const debounceRef = useRef(null);

    useEffect(() => {
        const params = { limit: 50 };
        if (status) params.status = status;
        if (search) params.search = search;
        dispatch(fetchComplaints(params));
    }, [dispatch, status, search]);

    const setStatusFilter = (value) => {
        const next = new URLSearchParams(searchParams);
        if (value) next.set('status', value); else next.delete('status');
        setSearchParams(next);
    };

    const handleSearchChange = (value) => {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const next = new URLSearchParams(searchParams);
            if (value.trim()) next.set('search', value.trim()); else next.delete('search');
            setSearchParams(next);
        }, 400);
    };

    return (
        <div>
            <Topbar
                title={isStaff ? 'All Reports' : 'My Reports'}
                subtitle={`${pagination.total} report${pagination.total === 1 ? '' : 's'} found`}
            />

            <div className="field" style={{ position: 'relative', maxWidth: 420 }}>
                <Search size={16} color="var(--color-placeholder)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                    type="text"
                    placeholder="Search by issue number, location, or problem…"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    style={{ paddingLeft: 38 }}
                />
            </div>

            <div className="filter-bar">
                {STATUS_FILTERS.map((f) => (
                    <button
                        key={f.value}
                        className={`filter-chip${status === f.value ? ' active' : ''}`}
                        onClick={() => setStatusFilter(f.value)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {listStatus === 'loading' && <div className="empty-state">Loading reports…</div>}

            {listStatus !== 'loading' && items.length === 0 && (
                <div className="empty-state">
                    <h3>No reports found</h3>
                    <p>Try a different search or filter, or report a new issue from the sidebar.</p>
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

export default ReportsListPage;
