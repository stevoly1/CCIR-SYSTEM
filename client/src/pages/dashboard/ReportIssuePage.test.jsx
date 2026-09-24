import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import ReportIssuePage from './ReportIssuePage';

vi.mock('react-redux', () => ({
    useDispatch: () => vi.fn(),
    useSelector: () => ({ createStatus: 'idle', error: null }),
}));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-hot-toast', () => ({
    default: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../api/axiosClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../slices/complaintSlice', () => ({
    createComplaint: Object.assign(vi.fn(), { fulfilled: { match: vi.fn(() => false) } }),
    resetCreateStatus: vi.fn(() => ({ type: 'reset' })),
}));

const fileOfSize = (name, size, type = 'image/jpeg') => new File([new Uint8Array(size)], name, { type });

describe('ReportIssuePage image selection', () => {
    beforeEach(() => {
        URL.createObjectURL = vi.fn((file) => `blob:${file.name}`);
        URL.revokeObjectURL = vi.fn();
    });

    const renderInput = () => {
        render(<ReportIssuePage />);
        return document.querySelector('#image');
    };

    it('advertises only the server-supported image MIME types', () => {
        const input = renderInput();
        expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    });

    it('rejects six selected images atomically without truncation', async () => {
        const input = renderInput();
        const user = userEvent.setup({ applyAccept: true });
        const files = Array.from({ length: 6 }, (_, index) => fileOfSize(`image-${index}.jpg`, 1));

        await user.upload(input, files);

        expect(toast.error).toHaveBeenCalledWith('You can add up to 5 photos per report');
        expect(screen.queryAllByAltText('preview')).toHaveLength(0);
    });

    it('rejects a file above 10 MiB', async () => {
        const input = renderInput();
        const user = userEvent.setup({ applyAccept: true });

        await user.upload(input, fileOfSize('large.jpg', (10 * 1024 * 1024) + 1));

        expect(toast.error).toHaveBeenCalledWith('Each photo must be 10 MiB or smaller');
        expect(screen.queryAllByAltText('preview')).toHaveLength(0);
    });

    it('rejects a selection above 25 MiB in aggregate', async () => {
        const input = renderInput();
        const user = userEvent.setup({ applyAccept: true });
        const files = [
            fileOfSize('one.jpg', 9 * 1024 * 1024),
            fileOfSize('two.jpg', 9 * 1024 * 1024),
            fileOfSize('three.jpg', 9 * 1024 * 1024),
        ];

        await user.upload(input, files);

        expect(toast.error).toHaveBeenCalledWith('Photos must total 25 MiB or less');
        expect(screen.queryAllByAltText('preview')).toHaveLength(0);
    });

    it('rejects a non-image selection even when chooser filtering is bypassed', () => {
        const input = renderInput();
        const file = fileOfSize('notes.txt', 1, 'text/plain');

        fireEvent.change(input, { target: { files: [file] } });

        expect(toast.error).toHaveBeenCalledWith('Photos must be JPEG, PNG, or WebP');
        expect(screen.queryAllByAltText('preview')).toHaveLength(0);
    });

    it('names each photo remove button and removes that photo', async () => {
        const input = renderInput();
        const user = userEvent.setup();
        await user.upload(input, [fileOfSize('a.jpg', 1), fileOfSize('b.jpg', 1)]);
        await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
        expect(screen.getAllByAltText('preview')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove photo 2' })).not.toBeInTheDocument();
    });

    it('lets keyboard users reach the photo picker through a named, focusable input', () => {
        const input = renderInput();
        expect(screen.getByLabelText('Add photos')).toBe(input);
        expect(input).not.toHaveStyle({ display: 'none' });
        expect(input).toHaveClass('visually-hidden');
        input.focus();
        expect(input).toHaveFocus();
    });
});
