import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Search, Pencil, Trash2 } from 'lucide-react';
import Topbar from '../../components/Topbar';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import Pager from '../../components/Pager';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';
import toast from 'react-hot-toast';

const ROLES = ['citizen', 'admin', 'agency'];
const PAGE_SIZE = 50;

const UsersPage = () => {
    const { user: currentUser } = useSelector((state) => state.auth);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
    const debounceRef = useRef(null);

    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', phone: '', role: 'citizen' });
    const [saving, setSaving] = useState(false);

    const [deletingUser, setDeletingUser] = useState(null);
    const [deleting, setDeleting] = useState(false);

    // The server pages the list; the count shown is the total across all pages.
    const loadUsers = useCallback(async (searchValue, page = 1) => {
        setLoading(true);
        try {
            const params = { ...(searchValue ? { search: searchValue } : {}), page, limit: PAGE_SIZE };
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
        debounceRef.current = setTimeout(() => loadUsers(value), 400);
    };

    const goToPage = (page) => {
        void loadUsers(search, page);
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

    const handleConfirmDelete = async () => {
        setDeleting(true);
        try {
            await axiosClient.delete(`/users/${deletingUser._id}`);
            toast.success('User deleted');
            setDeletingUser(null);
            // Reload rather than drop the row locally, so the page stays in step with the server.
            const lastOnPage = users.length === 1 && pagination.page > 1;
            await loadUsers(search, lastOnPage ? pagination.page - 1 : pagination.page);
        } catch (error) {
            toast.error(extractErrorMessage(error));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div>
            <Topbar title="Users" subtitle={`${pagination.total} registered account${pagination.total === 1 ? '' : 's'}`} />

            <div className="field" style={{ position: 'relative', maxWidth: 420 }}>
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
                        return (
                            <div key={u._id} className="complaint-card user-row">
                                <div className="avatar">{u.name?.[0]?.toUpperCase()}</div>
                                <div className="complaint-info">
                                    <div className="desc">{u.name}{isSelf && ' (you)'}</div>
                                    <div className="meta">{u.email}</div>
                                </div>
                                <div className="user-row-actions">
                                    <span className="badge" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}>
                                        {u.role}
                                    </span>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className="icon-btn" onClick={() => openEdit(u)} aria-label="Edit user">
                                            <Pencil size={15} />
                                        </button>
                                        <button
                                            className="icon-btn"
                                            onClick={() => setDeletingUser(u)}
                                            disabled={isSelf}
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
                                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={saving}>
                            {saving ? <span className="spinner" /> : 'Save changes'}
                        </button>
                    </form>
                </Modal>
            )}

            {deletingUser && (
                <ConfirmModal
                    title="Delete user"
                    message={`Delete ${deletingUser.name}'s account? This cannot be undone.`}
                    confirmLabel="Delete"
                    loading={deleting}
                    onConfirm={handleConfirmDelete}
                    onClose={() => setDeletingUser(null)}
                />
            )}
        </div>
    );
};

export default UsersPage;
