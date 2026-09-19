import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the resolved label', () => {
    render(<StatusBadge status="RESOLVED" />);

    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('falls back to pending for an unknown status', () => {
    render(<StatusBadge status="UNKNOWN" />);

    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
