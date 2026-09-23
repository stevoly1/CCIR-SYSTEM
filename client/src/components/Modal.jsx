import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible modal dialog: named by its title, focus moves into the body on open, Tab is
// trapped inside, and focus returns to the opening control on close.
const Modal = ({ title, onClose, children, width = 440 }) => {
    const titleId = useId();
    const dialogRef = useRef(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const opener = document.activeElement;
        const dialog = dialogRef.current;
        const initial = dialog.querySelector('.modal-body')?.querySelector(FOCUSABLE)
            ?? dialog.querySelector(FOCUSABLE)
            ?? dialog;
        initial.focus();

        const handleKey = (e) => {
            if (e.key === 'Escape') {
                onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll(FOCUSABLE)];
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('keydown', handleKey);
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        };
    }, []);

    return (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                ref={dialogRef}
                className="modal-card"
                style={{ maxWidth: width }}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <div className="modal-header">
                    <h3 id={titleId}>{title}</h3>
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
