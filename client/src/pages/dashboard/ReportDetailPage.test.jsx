import { render, screen } from '@testing-library/react';
import ReportDetailPage from './ReportDetailPage';

let state;
vi.mock('react-redux', () => ({ useDispatch: () => vi.fn(), useSelector: (select) => select(state) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'c1' }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/Topbar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock('../../slices/complaintSlice', () => ({
    fetchComplaint: vi.fn(() => ({ type: 'fetch' })),
    clearCurrentComplaint: vi.fn(() => ({ type: 'clear' })),
    updateComplaintStatus: Object.assign(vi.fn(), { fulfilled: { match: () => false } }),
    RELOAD_CODES: [],
    editComplaint: Object.assign(vi.fn(), { fulfilled: { match: () => false } }),
    withdrawComplaint: Object.assign(vi.fn(), { fulfilled: { match: () => false } }),
    deleteComplaint: Object.assign(vi.fn(), { fulfilled: { match: () => false } }),
}));

const complaint = {
    _id: 'c1', referenceCode: 'CCIR-REF-1', status: 'PENDING', priority: 'LOW', description: 'Pothole',
    category: { _id: 'k', name: 'Roads', recordedName: 'Roads' }, address: 'Bus stop', hasPrecisePosition: false,
    images: [], ai: { summary: '', tags: [] }, timeline: [], responsibility: 'AWAITING_ASSIGNMENT',
    canEdit: true, canWithdraw: true, version: 2,
};

describe('ReportDetailPage', () => {
    it('shows the loading state only before the first load', () => {
        state = { auth: { user: { _id: 'u1', role: 'citizen' } }, complaints: { current: null, detailStatus: 'loading' } };
        render(<ReportDetailPage />);
        expect(screen.getByText('Loading report…')).toBeInTheDocument();
    });

    it('explains a failed first load instead of loading forever', () => {
        state = { auth: { user: { _id: 'u1', role: 'citizen' } }, complaints: { current: null, detailStatus: 'failed' } };
        render(<ReportDetailPage />);
        expect(screen.getByText('This report could not be loaded.')).toBeInTheDocument();
        expect(screen.queryByText('Loading report…')).not.toBeInTheDocument();
    });

    it('keeps the report on screen while it refreshes in the background', () => {
        state = { auth: { user: { _id: 'u1', role: 'citizen' } }, complaints: { current: complaint, detailStatus: 'loading' } };
        render(<ReportDetailPage />);
        expect(screen.getByRole('heading', { name: 'CCIR-REF-1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit report' })).toBeInTheDocument();
        expect(screen.queryByText('Loading report…')).not.toBeInTheDocument();
    });
});
