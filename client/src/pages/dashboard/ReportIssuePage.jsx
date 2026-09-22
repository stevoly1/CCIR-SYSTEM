import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MapPin, ImagePlus, LocateFixed, X } from 'lucide-react';
import Topbar from '../../components/Topbar';
import axiosClient from '../../api/axiosClient';
import { createComplaint, resetCreateStatus } from '../../slices/complaintSlice';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const ReportIssuePage = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { createStatus, error } = useSelector((state) => state.complaints);

    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [coords, setCoords] = useState(null);
    const [predictions, setPredictions] = useState([]);
    const [locating, setLocating] = useState(false);
    const [images, setImages] = useState([]);
    const debounceRef = useRef(null);

    useEffect(() => {
        return () => dispatch(resetCreateStatus());
    }, [dispatch]);

    useEffect(() => {
        return () => images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAddressChange = (value) => {
        setAddress(value);
        setCoords(null);

        clearTimeout(debounceRef.current);
        if (value.trim().length < 3) {
            setPredictions([]);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            try {
                const { data } = await axiosClient.get('/location/autocomplete', { params: { input: value } });
                setPredictions(data.predictions);
            } catch {
                setPredictions([]);
            }
        }, 350);
    };

    const selectPrediction = (prediction) => {
        setAddress(prediction.label);
        setCoords({ latitude: prediction.latitude, longitude: prediction.longitude, coordinateSource: 'SUGGESTION' });
        setPredictions([]);
    };

    const useCurrentLocation = () => {
        if (!navigator.geolocation) {
            toast.error('Geolocation is not supported by this browser');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                setCoords({ latitude, longitude, coordinateSource: 'DEVICE' });
                try {
                    const { data } = await axiosClient.get('/location/geocode', { params: { latitude, longitude } });
                    setAddress(data.location?.address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
                    toast.success('Location captured');
                } catch {
                    setAddress(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
                    toast.success('Location captured');
                } finally {
                    setLocating(false);
                }
            },
            () => {
                setLocating(false);
                toast.error('Could not get your location');
            }
        );
    };

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
        if (address) formData.append('address', address);
        if (coords) {
            formData.append('latitude', coords.latitude);
            formData.append('longitude', coords.longitude);
            formData.append('coordinateSource', coords.coordinateSource);
        }
        images.forEach((img) => formData.append('image', img.file));

        const result = await dispatch(createComplaint(formData));
        if (createComplaint.fulfilled.match(result)) {
            toast.success(`Report submitted. Your reference code is ${result.payload.referenceCode}.`);
            navigate(`/dashboard/reports/${result.payload._id}`);
        } else {
            toast.error(result.payload || 'Something went wrong');
        }
    };

    return (
        <div>
            <Topbar title="Report an Issue" subtitle="Describe the problem and, if you can, add a photo and location." />

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

                <div className="field" style={{ position: 'relative' }}>
                    <label htmlFor="address">Location</label>
                    <input
                        id="address"
                        type="text"
                        placeholder="Start typing an address…"
                        value={address}
                        onChange={(e) => handleAddressChange(e.target.value)}
                        autoComplete="off"
                        required
                        minLength={3}
                    />
                    {predictions.length > 0 && (
                        <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                            marginTop: 4, zIndex: 10, boxShadow: 'var(--shadow-md)', overflow: 'hidden',
                        }}>
                            {predictions.map((p, idx) => (
                                <button
                                    type="button"
                                    key={`${p.label}-${idx}`}
                                    onClick={() => selectPrediction(p)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                        padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left',
                                        fontSize: '0.88rem', borderBottom: '1px solid var(--color-border)',
                                    }}
                                >
                                    <MapPin size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {p.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                    <button type="button" className="btn btn-outline" onClick={useCurrentLocation} disabled={locating} style={{ marginTop: 8, alignSelf: 'flex-start', padding: '8px 14px', fontSize: '0.82rem' }}>
                        <LocateFixed size={15} /> {locating ? 'Locating…' : 'Use my current location'}
                    </button>
                </div>

                <div className="field">
                    <label>Photos (optional, up to {MAX_IMAGES})</label>
                    <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 10, width: '100%',
                        background: '#fff', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)', padding: 12,
                    }}>
                        {images.map((img, index) => (
                            <div key={img.previewUrl} style={{ position: 'relative', width: 100, height: 100 }}>
                                <img src={img.previewUrl} alt="preview" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                                <button type="button" onClick={() => removeImage(index)} className="icon-btn" style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24 }}>
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                        {images.length < MAX_IMAGES && (
                            <label htmlFor="image" style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                gap: 4, width: 100, height: 100, border: '1.5px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer', color: 'var(--color-text-muted)',
                            }}>
                                <ImagePlus size={20} />
                                <span style={{ fontSize: '0.72rem' }}>Add photo</span>
                            </label>
                        )}
                    </div>
                    <input id="image" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageChange} style={{ display: 'none' }} />
                </div>

                <button className="btn btn-primary" type="submit" disabled={createStatus === 'loading'}>
                    {createStatus === 'loading' ? <span className="spinner" /> : 'Submit Report'}
                </button>
            </form>
        </div>
    );
};

export default ReportIssuePage;
