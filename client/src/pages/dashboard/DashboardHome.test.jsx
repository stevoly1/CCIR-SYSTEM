import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DashboardHome from './DashboardHome';

const state = {
  auth: { user: { name: 'Ada Lovelace', role: 'citizen' } },
  complaints: { items: [], listStatus: 'succeeded' },
};
const dispatch = vi.fn();
vi.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: (select) => select(state) }));
vi.mock('../../components/Topbar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock('../../components/ComplaintCard', () => ({ default: ({ complaint }) => <p>{complaint.referenceCode}</p> }));
vi.mock('../../slices/complaintSlice', () => ({ fetchComplaints: (args) => ({ type: 'fetchComplaints', args }) }));

const renderPage = () => render(<MemoryRouter><DashboardHome /></MemoryRouter>);

describe('DashboardHome', () => {
  beforeEach(() => {
    dispatch.mockReset();
    state.auth.user = { name: 'Ada Lovelace', role: 'citizen' };
    state.complaints = { items: [], listStatus: 'succeeded' };
  });

  it('loads the five most recent reports on arrival', () => {
    renderPage();
    expect(dispatch).toHaveBeenCalledWith({ type: 'fetchComplaints', args: { limit: 5 } });
  });

  it('greets the user by first name', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Ada');
  });

  it('offers a citizen their own reports', () => {
    renderPage();
    expect(screen.getByText('My Reports')).toBeInTheDocument();
    expect(screen.queryByText('All Reports')).not.toBeInTheDocument();
    expect(screen.getByText('Report an Issue')).toBeInTheDocument();
    expect(screen.getByText('Resolved Reports')).toBeInTheDocument();
  });

  it.each(['admin', 'agency'])('offers %s staff every report', (role) => {
    state.auth.user = { name: 'Chi Staff', role };
    renderPage();
    expect(screen.getByText('All Reports')).toBeInTheDocument();
    expect(screen.queryByText('My Reports')).not.toBeInTheDocument();
  });

  it('shows the loading state, then an empty state, then the recent reports', () => {
    state.complaints = { items: [], listStatus: 'loading' };
    const { unmount } = renderPage();
    expect(screen.getByText('Loading reports…')).toBeInTheDocument();
    unmount();

    state.complaints = { items: [], listStatus: 'succeeded' };
    const second = renderPage();
    expect(screen.getByText('No reports yet')).toBeInTheDocument();
    second.unmount();

    state.complaints = { items: [{ _id: 'c1', referenceCode: 'CCIR-EXAMPLE1' }], listStatus: 'succeeded' };
    renderPage();
    expect(screen.getByText('CCIR-EXAMPLE1')).toBeInTheDocument();
    expect(screen.queryByText('No reports yet')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/dashboard/reports');
  });
});
