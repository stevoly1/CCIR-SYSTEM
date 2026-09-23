import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import axiosClient from '../api/axiosClient';

// Address input with suggestions and device position. The address is always required;
// coordinates come only from a picked suggestion or the device, never from guessing.
const LocationField = ({ value, onChange, id = 'address' }) => {
    const [predictions, setPredictions] = useState([]);
    const [message, setMessage] = useState('');
    const [locating, setLocating] = useState(false);
    const debounceRef = useRef(null);

    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const suggest = (address) => {
        clearTimeout(debounceRef.current);
        if (address.trim().length < 3) {
            setPredictions([]);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            try {
                const { data } = await axiosClient.get('/location/autocomplete', { params: { input: address } });
                setPredictions(data.predictions);
            } catch {
                setPredictions([]);
                setMessage('Suggestions unavailable — type the address');
            }
        }, 350);
    };

    const handleTyping = (address) => {
        setMessage('');
        if (value.coordinateSource === 'DEVICE') {
            // The device position stays; the text is the human-readable address or landmark.
            onChange({ ...value, address });
            return;
        }
        // A picked suggestion no longer describes edited text, so its pair is dropped.
        onChange({ address });
        suggest(address);
    };

    const choose = (prediction) => {
        onChange({
            address: prediction.address,
            latitude: prediction.latitude,
            longitude: prediction.longitude,
            coordinateSource: 'SUGGESTION',
        });
        setPredictions([]);
        setMessage('');
    };

    const useDevice = () => {
        if (!navigator.geolocation) {
            setMessage('This browser cannot share a location — type the address instead.');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            async ({ coords }) => {
                const position = { latitude: coords.latitude, longitude: coords.longitude, coordinateSource: 'DEVICE' };
                try {
                    const { data } = await axiosClient.get('/location/geocode', {
                        params: { latitude: coords.latitude, longitude: coords.longitude },
                    });
                    if (data.location?.address) {
                        onChange({ address: data.location.address, ...position });
                        setMessage('Location captured');
                        return;
                    }
                } catch {
                    // Fall through: keep the position and ask for a landmark.
                } finally {
                    setLocating(false);
                }
                onChange({ address: '', ...position });
                setMessage('Position saved — please type a nearby address or landmark.');
            },
            (error) => {
                setLocating(false);
                setMessage(error?.code === 1
                    ? 'Location permission was denied — type the address instead.'
                    : 'Your location could not be found — type the address instead.');
            },
        );
    };

    return (
        <div className="field" style={{ position: 'relative' }}>
            <label htmlFor={id}>Location</label>
            <input
                id={id}
                type="text"
                placeholder="Start typing an address or landmark…"
                value={value.address}
                onChange={(e) => handleTyping(e.target.value)}
                autoComplete="off"
                required
                minLength={3}
                maxLength={500}
            />
            {predictions.length > 0 && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                    marginTop: 4, zIndex: 10, boxShadow: 'var(--shadow-md)', overflow: 'hidden',
                }}>
                    {predictions.map((p, index) => (
                        <button
                            type="button"
                            key={`${p.label}-${index}`}
                            onClick={() => choose(p)}
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
            <button
                type="button"
                className="btn btn-outline"
                onClick={useDevice}
                disabled={locating}
                style={{ marginTop: 8, alignSelf: 'flex-start', padding: '8px 14px', fontSize: '0.82rem' }}
            >
                <LocateFixed size={15} /> {locating ? 'Locating…' : 'Use my current location'}
            </button>
            {value.coordinateSource === 'DEVICE' && (
                <p className="meta">
                    Your precise position will be shared with staff handling this report.{' '}
                    <button
                        type="button"
                        style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            color: 'var(--color-primary)', textDecoration: 'underline', font: 'inherit',
                        }}
                        onClick={() => { onChange({ address: value.address }); setMessage(''); }}
                    >
                        Remove precise position
                    </button>
                </p>
            )}
            <p role="status" aria-live="polite" className="meta">{message}</p>
        </div>
    );
};

export default LocationField;
