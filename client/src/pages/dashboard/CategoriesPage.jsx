import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import Topbar from '../../components/Topbar';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { createCategory, deleteCategory, fetchCategories, updateCategory } from '../../slices/categorySlice';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const EMPTY = { name: '', description: '', defaultPriority: 'MEDIUM' };
const isFallback = (category) => category.name.trim().toLowerCase() === 'other';

const CategoryForm = ({ value, onChange, error, idPrefix }) => (
    <>
        <div className="field">
            <label htmlFor={`${idPrefix}-name`}>Name</label>
            <input id={`${idPrefix}-name`} value={value.name} required minLength={2} maxLength={60}
                aria-describedby={error ? `${idPrefix}-name-error` : undefined}
                aria-invalid={Boolean(error)}
                onChange={(e) => onChange({ ...value, name: e.target.value })} />
            {error && <p id={`${idPrefix}-name-error`} role="alert" className="field-error">{error}</p>}
        </div>
        <div className="field">
            <label htmlFor={`${idPrefix}-description`}>Description</label>
            <textarea id={`${idPrefix}-description`} rows={2} maxLength={1000} value={value.description}
                onChange={(e) => onChange({ ...value, description: e.target.value })} />
        </div>
        <div className="field">
            <label htmlFor={`${idPrefix}-priority`}>Default priority</label>
            <select id={`${idPrefix}-priority`} value={value.defaultPriority}
                onChange={(e) => onChange({ ...value, defaultPriority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
        </div>
    </>
);

const CategoriesPage = () => {
    const dispatch = useDispatch();
    const { items, status } = useSelector((state) => state.categories);
    const [draft, setDraft] = useState(EMPTY);
    const [draftError, setDraftError] = useState('');
    const [editing, setEditing] = useState(null);
    const [editError, setEditError] = useState('');
    const [confirm, setConfirm] = useState(null);
    const [rowErrors, setRowErrors] = useState({});
    // Guards against a double submit: a second create would hit the unique name and report a
    // conflict for the category the first request just created.
    const [saving, setSaving] = useState(false);

    useEffect(() => { dispatch(fetchCategories()); }, [dispatch]);

    const refresh = () => dispatch(fetchCategories());
    const fieldError = (payload) => (payload?.code === 'CATEGORY_NAME_CONFLICT' ? payload.message : '');

    const create = async (event) => {
        event.preventDefault();
        setDraftError('');
        setSaving(true);
        const result = await dispatch(createCategory({ ...draft, name: draft.name.trim() }));
        setSaving(false);
        if (createCategory.fulfilled.match(result)) { toast.success('Category added'); setDraft(EMPTY); refresh(); return; }
        setDraftError(fieldError(result.payload) || '');
        if (!fieldError(result.payload)) toast.error(result.payload?.message || 'Could not add category');
    };

    const saveEdit = async (event) => {
        event.preventDefault();
        setEditError('');
        const { _id, name, description, defaultPriority } = editing;
        setSaving(true);
        const result = await dispatch(updateCategory({ id: _id, name: name.trim(), description, defaultPriority }));
        setSaving(false);
        if (updateCategory.fulfilled.match(result)) { toast.success('Category saved'); setEditing(null); refresh(); return; }
        setEditError(fieldError(result.payload) || '');
        if (!fieldError(result.payload)) toast.error(result.payload?.message || 'Could not save category');
    };

    const runConfirmed = async () => {
        const { kind, category } = confirm;
        // Close at submission so the dialog cannot send the same action twice.
        setConfirm(null);
        setRowErrors((prev) => ({ ...prev, [category._id]: undefined }));
        const result = kind === 'delete'
            ? await dispatch(deleteCategory(category._id))
            : await dispatch(updateCategory({ id: category._id, isActive: kind === 'activate' }));
        const matcher = kind === 'delete' ? deleteCategory : updateCategory;
        if (matcher.fulfilled.match(result)) { refresh(); return; }
        setRowErrors((prev) => ({ ...prev, [category._id]: result.payload?.message || 'Action failed' }));
    };

    return (
        <div>
            <Topbar title="Categories" subtitle="Complaint types, default priorities, and availability" />
            <form onSubmit={create} aria-label="Add category" style={{ maxWidth: 520, marginBottom: 24 }}>
                <CategoryForm value={draft} onChange={setDraft} error={draftError} idPrefix="new-category" />
                <button className="btn btn-primary" type="submit" disabled={saving}>Add category</button>
            </form>

            {status === 'loading' && <div className="empty-state">Loading categories…</div>}
            <div className="data-table-wrap">
                <table className="data-table" aria-label="Categories">
                    <thead>
                        <tr><th>Name</th><th>Description</th><th>Default priority</th><th>Status</th><th className="num">Reports</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                        {items.map((category) => (
                            <tr key={category._id} aria-label={category.name}>
                                <td>{category.name}</td>
                                <td>{category.description}</td>
                                <td>{category.defaultPriority}</td>
                                <td>{category.isActive ? 'Active' : 'Inactive'}</td>
                                <td className="num">{category.complaintCount ?? 0}</td>
                                <td>
                                    {isFallback(category) ? (
                                        <span className="meta">System fallback — can&apos;t be renamed, deactivated, or deleted</span>
                                    ) : (
                                        <div className="data-table-actions">
                                            <button type="button" className="btn btn-outline" aria-label={`Edit ${category.name}`} onClick={() => { setEditError(''); setEditing({ ...category }); }}>Edit</button>
                                            {category.isActive
                                                ? <button type="button" className="btn btn-outline" aria-label={`Deactivate ${category.name}`} onClick={() => setConfirm({ kind: 'deactivate', category })}>Deactivate</button>
                                                : <button type="button" className="btn btn-outline" aria-label={`Activate ${category.name}`} onClick={() => setConfirm({ kind: 'activate', category })}>Activate</button>}
                                            {!category.isActive && (category.complaintCount ?? 0) === 0 && (
                                                <button type="button" className="btn btn-outline" aria-label={`Delete ${category.name}`} onClick={() => setConfirm({ kind: 'delete', category })}>Delete</button>
                                            )}
                                        </div>
                                    )}
                                    {rowErrors[category._id] && <p role="alert" className="field-error">{rowErrors[category._id]}</p>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {editing && (
                <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
                    <form onSubmit={saveEdit}>
                        <CategoryForm value={editing} onChange={setEditing} error={editError} idPrefix="edit-category" />
                        <button className="btn btn-primary btn-block" type="submit" disabled={saving}>Save category</button>
                    </form>
                </Modal>
            )}
            {confirm && (
                <ConfirmModal
                    title={`${confirm.kind[0].toUpperCase()}${confirm.kind.slice(1)} ${confirm.category.name}`}
                    message={confirm.kind === 'delete'
                        ? 'Delete this unused category permanently?'
                        : confirm.kind === 'deactivate'
                            ? 'Citizens will no longer see this category; existing reports keep it.'
                            : 'Make this category available again?'}
                    confirmLabel={`Confirm ${confirm.kind}`}
                    onConfirm={runConfirmed}
                    onClose={() => setConfirm(null)}
                />
            )}
        </div>
    );
};

export default CategoriesPage;
