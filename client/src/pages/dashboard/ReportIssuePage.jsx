import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { ImagePlus, X } from 'lucide-react';
import Topbar from '../../components/Topbar';
import VerifyEmailBanner from '../../components/account/VerifyEmailBanner';
import LocationField from '../../components/LocationField';
import { EMPTY_LOCATION, locationToFormData } from '../../components/locationValue';
import { createComplaint, resetCreateStatus } from '../../slices/complaintSlice';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const ReportIssuePage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { createStatus, error } = useSelector((state) => state.complaints);
    const user = useSelector((state) => state.auth.user);

    const [description, setDescription] = useState('');
    const [location, setLocation] = useState(EMPTY_LOCATION);
    const [images, setImages] = useState([]);

    useEffect(() => {
        return () => dispatch(resetCreateStatus());
    }, [dispatch]);

    useEffect(() => {
        return () => images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleImageChange = (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        const rejectSelection = (message) => {
            toast.error(message);
            e.target.value = '';
        };
        if (images.length + files.length > MAX_IMAGES) {
            toast.error(`You can add up to ${MAX_IMAGES} photos per report`);
            e.target.value = '';
            return;
        }
        if (files.some((file) => !ACCEPTED_IMAGE_TYPES.has(file.type))) {
            rejectSelection('Photos must be JPEG, PNG, or WebP');
            return;
        }
        if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
            rejectSelection('Each photo must be 10 MiB or smaller');
            return;
        }
        const aggregateSize = [...images.map((image) => image.file), ...files]
            .reduce((sum, file) => sum + file.size, 0);
        if (aggregateSize > MAX_AGGREGATE_BYTES) {
            rejectSelection('Photos must total 25 MiB or less');
            return;
        }

        const accepted = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
        setImages((prev) => [...prev, ...accepted]);
        e.target.value = '';
    };

    const removeImage = (index) => {
        setImages((prev) => {
            URL.revokeObjectURL(prev[index].previewUrl);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const formData = new FormData();
        formData.append('description', description);
        locationToFormData(formData, location);
        images.forEach((img) => formData.append('image', img.file));

        const result = await dispatch(createComplaint(formData));
        if (createComplaint.fulfilled.match(result)) {
            toast.success(`Report submitted. Your reference code is ${result.payload.referenceCode}.`);
            navigate(`/dashboard/reports/${result.payload._id}`);
        } else {
            toast.error(result.payload || 'Something went wrong');
        }
    };

    // Filing needs a verified address; the server refuses it otherwise.
    if (user?.emailVerified === false) {
        return (
            <div>
                <Topbar title="Report an Issue" subtitle="Verify your email address first." />
                <VerifyEmailBanner variant="panel" />
            </div>
        );
    }

    return (
        <div>
            <Topbar title="Report an Issue" subtitle="Describe the problem and where it is. Add a photo if you can." />

            <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
                {error && <div className="form-error-banner">{error}</div>}

                <div className="field">
                    <label htmlFor="description">What's the issue?</label>
                    <textarea
                        id="description"
                        rows={5}
                        placeholder="e.g. There's a large pothole outside 12 Main Street that's damaging cars..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        minLength={10}
                        required
                    />
                </div>

                <LocationField value={location} onChange={setLocation} />

                <div className="field">
                    <span id="photos-heading" className="field-heading">Photos (optional, up to {MAX_IMAGES})</span>
                    <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 10, width: '100%',
                        background: '#fff', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)', padding: 12,
                    }}>
                        {images.map((img, index) => (
                            <div key={img.previewUrl} style={{ position: 'relative', width: 100, height: 100 }}>
                                <img src={img.previewUrl} alt="preview" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                                <button type="button" onClick={() => removeImage(index)} aria-label={`Remove photo ${index + 1}`} className="icon-btn" style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24 }}>
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                        {images.length < MAX_IMAGES && (
                            // The input is visually hidden but focusable, so keyboard users can reach it.
                            <label className="photo-picker" style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                gap: 4, width: 100, height: 100, border: '1.5px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer', color: 'var(--color-text-muted)',
                            }}>
                                <ImagePlus size={20} aria-hidden="true" />
                                <span style={{ fontSize: '0.72rem' }} aria-hidden="true">Add photo</span>
                                <input
                                    id="image"
                                    type="file"
                                    className="visually-hidden"
                                    aria-label="Add photos"
                                    aria-describedby="photos-heading"
                                    accept="image/jpeg,image/png,image/webp"
                                    multiple
                                    onChange={handleImageChange}
                                />
                            </label>
                        )}
                    </div>
                </div>

                <button className="btn btn-primary" type="submit" disabled={createStatus === 'loading'}>
                    {createStatus === 'loading' ? <span className="spinner" /> : 'Submit Report'}
                </button>
            </form>
        </div>
    );
};

export default ReportIssuePage;
