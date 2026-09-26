import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Search, Pencil, Trash2, Ban, RotateCcw } from 'lucide-react';
import Topbar from '../../components/Topbar';
import Modal from '../../components/Modal';
import AdminEmailChange from '../../components/account/AdminEmailChange';
import ReasonDialog from '../../components/ReasonDialog';
import Pager from '../../components/Pager';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';
import toast from 'react-hot-toast';

const ROLES = ['citizen', 'admin', 'agency'];
const ROLE_FILTERS = [
    { value: '', label: 'All roles' },
    { value: 'citizen', label: 'Citizens' },
    { value: 'agency', label: 'Agency staff' },
    { value: 'admin', label: 'Administrators' },
];
const PAGE_SIZE = 50;

// A retired account's sign-in and contact details are gone and the server refuses any change;
// a suspended one is kept but cannot sign in until an administrator reactivates it.
const accountState = (u) => {
    if (u.retiredAt) return { label: 'Retired', style: { background: '#F1F1F1', color: 'var(--color-text-muted)' } };
    if (u.isActive === false) return { label: 'Suspended', style: { background: '#FDECEE', color: 'var(--color-status-rejected)' } };
    return null;
};

const UsersPage = () => {
    const { user: currentUser } = useSelector((state) => state.auth);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [role, setRole] = useState('');
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
    const debounceRef = useRef(null);

    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', phone: '', role: 'citizen' });
    const [saving, setSaving] = useState(false);

    // One pending account action at a time: { kind: 'delete' | 'suspend' | 'reactivate', user }.
    const [pending, setPending] = useState(null);
    const [acting, setActing] = useState(false);

    // The server pages the list; the count shown is the total across all pages.
    const loadUsers = useCallback(async (searchValue, page = 1, roleValue = '') => {
        setLoading(true);
        try {
            const params = { ...(searchValue ? { search: searchValue } : {}), ...(roleValue ? { role: roleValue } : {}), page, limit: PAGE_SIZE };
            const { data } = await axiosClient.get('/users', { params });
            setUsers(data.users);
            setPagination(data.pagination ?? { page, pages: 1, total: data.users.length });
        } catch (error) {
            toast.error(extractErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            void loadUsers('');
        }, 0);

        return () => clearTimeout(timeoutId);
    }, [loadUsers]);

    const handleSearchChange = (value) => {
        setSearch(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => loadUsers(value, 1, role), 400);
    };

    const handleRoleChange = (value) => {
        setRole(value);
        // A search still waiting to run would reload the list without this role.
        clearTimeout(debounceRef.current);
        void loadUsers(search, 1, value);
    };

    const goToPage = (page) => {
        void loadUsers(search, page, role);
        document.querySelector('.main-content')?.scrollIntoView?.({ block: 'start' });
    };

    const openEdit = (u) => {
        setEditingUser(u);
        setEditForm({ name: u.name, phone: u.phone || '', role: u.role });
    };

    const handleSaveEdit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { data } = await axiosClient.patch(`/users/${editingUser._id}`, editForm);
            setUsers((prev) => prev.map((u) => (u._id === editingUser._id ? data.user : u)));
            toast.success('User updated');
            setEditingUser(null);
        } catch (error) {
            toast.error(extractErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const ACTIONS = {
        delete: {
            run: (u, reason) => (reason ? axiosClient.delete(`/users/${u._id}`, { data: { reason } }) : axiosClient.delete(`/users/${u._id}`)),
            done: 'User deleted',
        },
        suspend: {
            run: (u, reason) => axiosClient.patch(`/users/${u._id}`, { isActive: false, ...(reason ? { reason } : {}) }),
            done: 'Account suspended',
        },
        reactivate: {
            run: (u) => axiosClient.patch(`/users/${u._id}`, { isActive: true }),
            done: 'Account reactivated',
        },
    };

    const handleConfirmAction = async (reason) => {
        const { kind, user: target } = pending;
        setActing(true);
        try {
            await ACTIONS[kind].run(target, reason);
            toast.success(ACTIONS[kind].done);
            setPending(null);
            // Reload rather than change the row locally, so the page stays in step with the server.
            const lastOnPage = kind === 'delete' && users.length === 1 && pagination.page > 1;
            await loadUsers(search, lastOnPage ? pagination.page - 1 : pagination.page, role);
        } catch (error) {
            toast.error(extractErrorMessage(error));
        } finally {
            setActing(false);
        }
    };

    return (
        <div>
            <Topbar title="Users" subtitle={`${pagination.total} registered account${pagination.total === 1 ? '' : 's'}`} />

            <div className="list-controls">
                <div className="field list-search">
                    <Search size={16} color="var(--color-placeholder)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        aria-label="Search users"
                        placeholder="Search by name or email…"
                        value={search}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        style={{ paddingLeft: 38 }}
                    />
                </div>
                <div className="field list-filter">
                    <select aria-label="Filter by role" value={role} onChange={(e) => handleRoleChange(e.target.value)}>
                        {ROLE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </div>
            </div>

            {loading && <div className="empty-state">Loading users…</div>}

            {!loading && users.length === 0 && (
                <div className="empty-state">
                    <h3>No users found</h3>
                    <p>Try a different search.</p>
                </div>
            )}

            {!loading && users.length > 0 && (
                <div className="card-list">
                    {users.map((u) => {
                        const isSelf = u._id === currentUser?._id;
                        const state = accountState(u);
                        const retired = Boolean(u.retiredAt);
                        const suspended = !retired && u.isActive === false;
                        return (
                            <div key={u._id} className="complaint-card user-row">
                                <div className="avatar">{u.name?.[0]?.toUpperCase()}</div>
                                <div className="complaint-info">
                                    <div className="desc">{u.name}{isSelf && ' (you)'}</div>
                                    <div className="meta">{u.email}</div>
                                    {suspended && u.suspendedAt && (
                                        <div className="meta">
                                            Suspended on {new Date(u.suspendedAt).toLocaleDateString()}
                                            {u.suspensionReason && ` — ${u.suspensionReason}`}
                                        </div>
                                    )}
                                </div>
                                <div className="user-row-actions">
                                    <span className="badge" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}>
                                        {u.role}
                                    </span>
                                    {state && <span className="badge" style={state.style}>{state.label}</span>}
                                    {u.emailVerified === false && !u.retiredAt && <span className="badge" style={{ background: '#FFF4E5', color: '#8A4B00' }}>Email not verified</span>}
                                    <div className="user-row-buttons">
                                        <button className="icon-btn" onClick={() => openEdit(u)} disabled={retired} title={retired ? 'Retired accounts cannot be changed' : 'Edit user'} aria-label="Edit user">
                                            <Pencil size={15} />
                                        </button>
                                        {suspended ? (
                                            <button className="icon-btn" onClick={() => setPending({ kind: 'reactivate', user: u })} title="Reactivate user" aria-label="Reactivate user">
                                                <RotateCcw size={15} />
                                            </button>
                                        ) : (
                                            <button
                                                className="icon-btn"
                                                onClick={() => setPending({ kind: 'suspend', user: u })}
                                                disabled={isSelf || retired}
                                                title={isSelf ? "You can't suspend your own account" : 'Suspend user'}
                                                aria-label="Suspend user"
                                            >
                                                <Ban size={15} />
                                            </button>
                                        )}
                                        <button
                                            className="icon-btn"
                                            onClick={() => setPending({ kind: 'delete', user: u })}
                                            disabled={isSelf || retired}
                                            title={isSelf ? "You can't delete your own account here" : 'Delete user'}
                                            aria-label="Delete user"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {!loading && (
                <Pager page={pagination.page} pages={pagination.pages} onChange={goToPage} label="User pages" />
            )}

            {editingUser && (
                <Modal title="Edit user" onClose={() => setEditingUser(null)}>
                    <form onSubmit={handleSaveEdit}>
                        <div className="field">
                            <label htmlFor="edit-email">Email</label>
                            <input id="edit-email" value={editingUser.email} disabled />
                            <AdminEmailChange user={editingUser} isSelf={editingUser._id === currentUser?._id} />
                        </div>
                        <div className="field">
                            <label htmlFor="edit-name">Full name</label>
                            <input
                                id="edit-name"
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                required
                                minLength={2}
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="edit-phone">Phone</label>
                            <input
                                id="edit-phone"
                                type="tel"
                                value={editForm.phone}
                                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                placeholder="Optional"
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="edit-role">Role</label>
                            <select
                                id="edit-role"
                                value={editForm.role}
                                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                                disabled={editingUser._id === currentUser?._id}
                            >
                                {ROLES.map((r) => (
                                    <option key={r} value={r} disabled={editingUser.emailVerified === false && r !== 'citizen' && r !== editingUser.role}>{r}</option>
                                ))}
                            </select>
                            {editingUser.emailVerified === false && (
                                <p className="field-hint">Verify this account&apos;s email address before giving it a staff role.</p>
                            )}
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={saving}>
                            {saving ? <span className="spinner" /> : 'Save changes'}
                        </button>
                    </form>
                </Modal>
            )}

            {pending?.kind === 'delete' && (
                <ReasonDialog
                    title="Delete user"
                    message={`Delete ${pending.user.name}'s account? Their sign-in and contact details are removed and their reports stay, shown as "Retired account". This cannot be undone.`}
                    confirmLabel="Delete"
                    danger
                    loading={acting}
                    onConfirm={handleConfirmAction}
                    onClose={() => setPending(null)}
                />
            )}
            {pending?.kind === 'suspend' && (
                <ReasonDialog
                    title="Suspend user"
                    message={`Suspend ${pending.user.name}? They are signed out now and cannot sign in until an administrator reactivates the account. Their reports and history stay.`}
                    confirmLabel="Suspend"
                    danger
                    loading={acting}
                    onConfirm={handleConfirmAction}
                    onClose={() => setPending(null)}
                />
            )}
            {pending?.kind === 'reactivate' && (
                <ReasonDialog
                    title="Reactivate user"
                    message={`Reactivate ${pending.user.name}? They can sign in again straight away.`}
                    confirmLabel="Reactivate"
                    withReason={false}
                    loading={acting}
                    onConfirm={handleConfirmAction}
                    onClose={() => setPending(null)}
                />
            )}
        </div>
    );
};

export default UsersPage;
