import { ChevronLeft, ChevronRight } from 'lucide-react';

// Previous / next controls for a server-paginated list; hidden when one page holds everything.
const Pager = ({ page, pages, onChange, label }) => {
    if (!pages || pages <= 1) return null;

    return (
        <nav className="pager" aria-label={label}>
            <button type="button" className="btn btn-outline" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
                <ChevronLeft size={16} /> Previous
            </button>
            <span className="pager-status">Page {page} of {pages}</span>
            <button type="button" className="btn btn-outline" onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page">
                Next <ChevronRight size={16} />
            </button>
        </nav>
    );
};

export default Pager;
