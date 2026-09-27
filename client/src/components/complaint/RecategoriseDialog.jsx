import { useEffect, useId, useState } from 'react';
import Modal from '../Modal';
import axiosClient, { extractErrorCode, extractErrorMessage } from '../../api/axiosClient';

const REASON_MIN = 3;

// A staff category decision keeps its reason in private history.
const RecategoriseDialog = ({ complaint, initialCategoryId, title, onClose, onDone, onConflict }) => {
    const [categories, setCategories] = useState([]);
    const [categoryId, setCategoryId] = useState(initialCategoryId);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const categoryField = useId();
    const reasonField = useId();

    useEffect(() => {
        let active = true;
        axiosClient.get('/categories')
            .then(({ data }) => { if (active) setCategories(data.categories.filter((category) => category.isActive !== false)); })
            .catch(() => { if (active) setError('Categories could not be loaded'); });
        return () => { active = false; };
    }, []);

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            await axiosClient.patch(`/complaints/${complaint._id}/category`, { categoryId, reason: reason.trim(), expectedVersion: complaint.version });
            onDone();
        } catch (err) {
            if (extractErrorCode(err) === 'STALE_COMPLAINT') { onConflict(); return; }
            setError(extractErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={title} onClose={saving ? () => {} : onClose} width={440}>
            <div className="field">
                <label htmlFor={categoryField}>Category</label>
                <select id={categoryField} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
                </select>
            </div>
            <div className="field">
                <label htmlFor={reasonField}>Reason (staff only)</label>
                <textarea id={reasonField} rows={3} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
            {error && <p role="alert" className="field-error">{error}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={saving || reason.trim().length < REASON_MIN || !categoryId || !categories.some((category) => category._id === categoryId)}>
                    {saving ? <span className="spinner" /> : 'Save category'}
                </button>
            </div>
        </Modal>
    );
};

export default RecategoriseDialog;
