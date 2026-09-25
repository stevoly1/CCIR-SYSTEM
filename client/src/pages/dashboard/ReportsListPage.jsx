import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import Topbar from '../../components/Topbar';
import ComplaintCard from '../../components/ComplaintCard';
import Pager from '../../components/Pager';
import { fetchComplaints } from '../../slices/complaintSlice';
import { fetchCategories } from '../../slices/categorySlice';
import axiosClient from '../../api/axiosClient';
import { PRIORITIES, PRIORITY_LABELS } from '../../components/labels';

const STATUS_FILTERS = [
    { label: 'All', value: '' },
    { label: 'Pending', value: 'PENDING' },
    { label: 'In Review', value: 'IN_REVIEW' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'Resolved', value: 'RESOLVED' },
    { label: 'Rejected', value: 'REJECTED' },
    { label: 'Withdrawn', value: 'WITHDRAWN' },
];

const PAGE_SIZE = 50;
// Filters kept in the address, so a reload or the back button returns to the same list.
const FILTER_PARAMS = ['priority', 'category', 'sort', 'assignee'];

const ReportsListPage = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state) => state.auth);
    const { items, listStatus, pagination } = useSelector((state) => state.complaints);
    const categories = useSelector((state) => state.categories.items);
    const [searchParams, setSearchParams] = useSearchParams();
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const mine = searchParams.get('mine') === '1';
    const page = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1);
    const isAgency = user?.role === 'agency';
    const isStaff = user?.role === 'admin' || user?.role === 'agency';
    const isAdmin = user?.role === 'admin';
    const [priority, category, sort, assignee] = FILTER_PARAMS.map((name) => searchParams.get(name) || '');
    // null until the list arrives (or if it cannot be loaded).
    const [assignable, setAssignable] = useState(null);

    useEffect(() => {
        dispatch(fetchCategories());
    }, [dispatch]);

    // Administrators pick an agent, or "Unassigned", to see what each one holds.
    useEffect(() => {
        if (!isAdmin) return undefined;
        let active = true;
        axiosClient.get('/users/assignable')
            .then(({ data }) => { if (active) setAssignable(data.users); })
            .catch(() => {});
        return () => { active = false; };
    }, [isAdmin]);

    const [searchInput, setSearchInput] = useState(search);
    const debounceRef = useRef(null);

    useEffect(() => {
        const params = { limit: PAGE_SIZE, page };
        if (status) params.status = status;
        if (search) params.search = search;
        if (priority) params.priority = priority;
        if (category) params.category = category;
        if (sort) params.sort = sort;
        if (isAgency && mine && user?._id) params.assignedTo = user._id;
        if (isAdmin && assignee) params.assignedTo = assignee;
        dispatch(fetchComplaints(params));
    }, [dispatch, status, search, priority, category, sort, assignee, isAgency, isAdmin, mine, page, user?._id]);

    // Any change to what is listed starts again from its first page.
    const withoutPage = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('page');
        return next;
    };

    const setPage = (value) => {
        const next = new URLSearchParams(searchParams);
        if (value > 1) next.set('page', String(value)); else next.delete('page');
        setSearchParams(next);
        document.querySelector('.main-content')?.scrollIntoView?.({ block: 'start' });
    };

    const toggleMine = () => {
        const next = withoutPage();
        if (mine) next.delete('mine'); else next.set('mine', '1');
        setSearchParams(next);
    };

    const setFilter = (name, value) => {
        const next = withoutPage();
        if (value) next.set(name, value); else next.delete(name);
        setSearchParams(next);
    };

    const setStatusFilter = (value) => {
        const next = withoutPage();
        if (value) next.set('status', value); else next.delete('status');
        setSearchParams(next);
    };

    const handleSearchChange = (value) => {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const next = withoutPage();
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

            <div className="list-controls">
                <div className="field list-search">
                    <Search size={16} color="var(--color-placeholder)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        aria-label="Search reports"
                        placeholder="Search by issue number, location, or problem…"
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        style={{ paddingLeft: 38 }}
                    />
                </div>
                <div className="field list-filter">
                    <select aria-label="Filter by priority" value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
                        <option value="">All priorities</option>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                </div>
                <div className="field list-filter">
                    <select aria-label="Filter by category" value={category} onChange={(e) => setFilter('category', e.target.value)}>
                        <option value="">All categories</option>
                        {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                </div>
                {isAdmin && (
                    <div className="field list-filter">
                        <select aria-label="Filter by assignee" value={assignee} onChange={(e) => setFilter('assignee', e.target.value)}>
                            <option value="">Anyone</option>
                            <option value="none">Unassigned</option>
                            {(assignable ?? []).map((a) => <option key={a.userId} value={a.userId}>{a.displayName}</option>)}
                            {/* The address can name someone not in the list: it still filters by them. */}
                            {assignee && assignee !== 'none' && !assignable?.some((a) => a.userId === assignee) && (
                                <option value={assignee}>{assignable ? 'Someone no longer assignable' : 'Selected staff member'}</option>
                            )}
                        </select>
                    </div>
                )}
                <div className="field list-filter">
                    <select aria-label="Sort order" value={sort || 'newest'} onChange={(e) => setFilter('sort', e.target.value === 'newest' ? '' : e.target.value)}>
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                    </select>
                </div>
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
                {isAgency && (
                    <button
                        type="button"
                        className={`filter-chip${mine ? ' active' : ''}`}
                        aria-pressed={mine}
                        onClick={toggleMine}
                    >
                        Assigned to me
                    </button>
                )}
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

            {listStatus !== 'loading' && (
                <Pager page={pagination.page ?? page} pages={pagination.pages} onChange={setPage} label="Report pages" />
            )}
        </div>
    );
};

export default ReportsListPage;
