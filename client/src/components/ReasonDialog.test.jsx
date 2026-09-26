import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReasonDialog from './ReasonDialog';

const renderDialog = (props = {}) => {
  const onConfirm = vi.fn();
  render(<ReasonDialog title="Do it" message="Sure?" confirmLabel="Go" onConfirm={onConfirm} onClose={vi.fn()} {...props} />);
  return onConfirm;
};

describe('ReasonDialog', () => {
  it('takes an optional reason by default', async () => {
    const onConfirm = renderDialog();
    const user = userEvent.setup();
    expect(screen.getByLabelText('Reason (optional)')).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('needs a reason of at least 3 characters when it is required', async () => {
    const onConfirm = renderDialog({ reasonRequired: true });
    const user = userEvent.setup();
    expect(screen.getByLabelText('Reason')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reason'), '  ab ');
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reason'), 'c');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).toHaveBeenCalledWith('ab c');
  });
});
