import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { createComplaint } from '../../slices/complaintSlice';
import { fetchCategories } from '../../slices/categorySlice';
import ReportIssuePage from './ReportIssuePage';

const dispatchSpy = vi.hoisted(() => vi.fn((action) => action));
const state = { complaints: { createStatus: 'idle', error: null }, auth: { user: { email: 'ada@example.test', emailVerified: true } }, categories: { items: [] } };
vi.mock('react-redux', () => ({
    useDispatch: () => dispatchSpy,
    useSelector: (select) => select(state),
}));
vi.mock('../../components/account/VerifyEmailBanner', () => ({ default: () => <p>verify panel stub</p> }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-hot-toast', () => ({
    default: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('../../components/Topbar', () => ({ default: () => null }));
vi.mock('../../api/axiosClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../slices/complaintSlice', () => ({
    createComplaint: Object.assign(vi.fn(() => ({ type: 'create/rejected', payload: 'Test response' })), { fulfilled: { match: vi.fn(() => false) } }),
    resetCreateStatus: vi.fn(() => ({ type: 'reset' })),
}));
vi.mock('../../slices/categorySlice', () => ({ fetchCategories: vi.fn(() => ({ type: 'fetchCategories' })) }));

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

describe('ReportIssuePage and email verification', () => {
    afterEach(() => { state.auth = { user: { email: 'ada@example.test', emailVerified: true } }; });

    it('asks an unverified account to verify instead of showing the form', () => {
        state.auth = { user: { email: 'ada@example.test', emailVerified: false } };
        render(<ReportIssuePage />);
        expect(screen.getByText('verify panel stub')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Submit Report' })).toBeNull();
    });

    it('shows the form to a verified account', () => {
        render(<ReportIssuePage />);
        expect(screen.queryByText('verify panel stub')).toBeNull();
        expect(screen.getByRole('button', { name: 'Submit Report' })).toBeInTheDocument();
    });
});

describe('ReportIssuePage category choice', () => {
    beforeEach(() => {
        state.categories.items = [{ _id: 'c-roads', name: 'Roads', isActive: true }, { _id: 'c-old', name: 'Old', isActive: false }];
        createComplaint.mockClear();
        fetchCategories.mockClear();
    });
    afterEach(() => { state.categories.items = []; });

    const submit = async () => {
        fireEvent.change(screen.getByLabelText("What's the issue?"), { target: { value: 'A deep pothole near the market' } });
        fireEvent.submit(document.querySelector('form'));
        await vi.waitFor(() => expect(createComplaint).toHaveBeenCalledTimes(1));
        return createComplaint.mock.calls[0][0];
    };

    it('sends the active category selected by the citizen', async () => {
        const user = userEvent.setup();
        render(<ReportIssuePage />);
        expect(fetchCategories).toHaveBeenCalledTimes(1);
        const select = screen.getByLabelText('Category (optional)');
        expect(select).toHaveValue('');
        expect(screen.queryByRole('option', { name: 'Old' })).not.toBeInTheDocument();
        await user.selectOptions(select, 'c-roads');
        expect((await submit()).get('categoryId')).toBe('c-roads');
    });

    it('sends no category when the citizen leaves the AI choice selected', async () => {
        render(<ReportIssuePage />);
        expect(screen.getByRole('option', { name: 'Let the AI choose' })).toBeInTheDocument();
        expect((await submit()).has('categoryId')).toBe(false);
    });
});
