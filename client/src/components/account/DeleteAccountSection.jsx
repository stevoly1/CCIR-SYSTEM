import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import axiosClient, { extractErrorMessage } from '../../api/axiosClient';
import { accountDeleted } from '../../slices/authSlice';

const DeleteAccountSection = ({ user }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ secret: '', reason: '' });
    const [deleting, setDeleting] = useState(false);
    const google = user.authProvider === 'google';

    if (user.role === 'admin') {
        return (
            <section className="profile-section" aria-labelledby="delete-heading">
                <h3 id="delete-heading">Delete account</h3>
                <p>Administrators cannot delete their own account. Another administrator can retire it.</p>
            </section>
        );
    }

    const handleDelete = async (e) => {
        e.preventDefault();
        const body = google ? { confirmEmail: form.secret } : { password: form.secret };
        if (form.reason.trim()) body.reason = form.reason.trim();
        setDeleting(true);
        try {
            await axiosClient.delete('/users/profile', { data: body });
            dispatch(accountDeleted());
            navigate('/account-deleted', { replace: true });
        } catch (err) {
            toast.error(extractErrorMessage(err));
            setDeleting(false);
        }
    };

    return (
        <section className="profile-section" aria-labelledby="delete-heading">
            <h3 id="delete-heading">Delete account</h3>
            <p>Your name and contact details are removed and you are signed out everywhere. Reports you filed stay with the agencies, without your name.</p>
            <button className="btn btn-danger" type="button" onClick={() => setOpen(true)}>Delete account</button>
            {open && (
                <Modal title="Delete your account" onClose={() => setOpen(false)}>
                    <form onSubmit={handleDelete}>
                        <div className="field">
                            <label htmlFor="delete-secret">{google ? 'Type your email address to confirm' : 'Password'}</label>
                            <input id="delete-secret" type={google ? 'email' : 'password'} autoComplete={google ? 'off' : 'current-password'} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} required />
                        </div>
                        <div className="field">
                            <label htmlFor="delete-reason">Reason (optional)</label>
                            <textarea id="delete-reason" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                        </div>
                        <button className="btn btn-danger" type="submit" disabled={deleting}>
                            {deleting ? <span className="spinner" /> : 'Delete my account'}
                        </button>
                    </form>
                </Modal>
            )}
        </section>
    );
};

export default DeleteAccountSection;
