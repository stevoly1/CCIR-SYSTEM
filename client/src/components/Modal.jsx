import { useEffect } from 'react';
import { X } from 'lucide-react';

const Modal = ({ title, onClose, children, width = 440 }) => {
    useEffect(() => {
        const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-card" style={{ maxWidth: width }}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
};

export default Modal;
