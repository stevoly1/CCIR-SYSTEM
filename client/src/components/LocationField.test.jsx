import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import axiosClient from '../api/axiosClient';
import LocationField from './LocationField';
import { EMPTY_LOCATION, locationToFormData, locationToJson } from './locationValue';

vi.mock('../api/axiosClient', () => ({ default: { get: vi.fn() } }));

let latest;
const Harness = () => {
    const [value, setValue] = useState(EMPTY_LOCATION);
    const handleChange = (next) => {
        latest = next;
        setValue(next);
    };
    return <LocationField value={value} onChange={handleChange} />;
};

const geolocation = (impl) => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: impl } });
};

describe('LocationField', () => {
    beforeEach(() => { latest = undefined; axiosClient.get.mockReset(); });

    it('requires an address', () => {
        render(<Harness />);
        expect(screen.getByLabelText('Location')).toBeRequired();
    });

    it('sets SUGGESTION coordinates from a picked suggestion and clears them on typing', async () => {
        axiosClient.get.mockResolvedValue({ data: { predictions: [{ label: '12 Market Road, Ikeja', address: '12 Market Road, Ikeja', latitude: 6.6, longitude: 3.3 }] } });
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(screen.getByLabelText('Location'), 'Mark');
        await user.click(await screen.findByRole('button', { name: /12 Market Road/ }));
        expect(latest).toEqual({ address: '12 Market Road, Ikeja', latitude: 6.6, longitude: 3.3, coordinateSource: 'SUGGESTION' });
        await user.type(screen.getByLabelText('Location'), 'x');
        expect(latest).toEqual({ address: '12 Market Road, Ikejax' });
    });

    it('explains unavailable suggestions without blocking typing', async () => {
        axiosClient.get.mockRejectedValue({ response: { status: 503, data: { error: { code: 'LOCATION_PROVIDER_UNAVAILABLE' } } } });
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(screen.getByLabelText('Location'), 'Market');
        expect(await screen.findByText('Suggestions unavailable — type the address')).toBeInTheDocument();
        expect(latest.address).toBe('Market');
    });

    it('keeps a device position and asks for a landmark when reverse lookup finds nothing', async () => {
        geolocation((success) => success({ coords: { latitude: 6.5, longitude: 3.4 } }));
        axiosClient.get.mockResolvedValue({ data: { location: { address: null, latitude: 6.5, longitude: 3.4 } } });
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: /use my current location/i }));
        await waitFor(() => expect(latest).toEqual({ address: '', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' }));
        expect(screen.getByText('Position saved — please type a nearby address or landmark.')).toBeInTheDocument();
    });

    it('keeps a device position when reverse lookup fails, and typing keeps it', async () => {
        geolocation((success) => success({ coords: { latitude: 6.5, longitude: 3.4 } }));
        axiosClient.get.mockRejectedValue(new Error('offline'));
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: /use my current location/i }));
        await waitFor(() => expect(latest.coordinateSource).toBe('DEVICE'));
        expect(latest.address).toBe('');
        await user.type(screen.getByLabelText('Location'), 'Oja');
        expect(latest).toEqual({ address: 'Oja', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' });
    });

    it('lets the reporter discard a device position and return to suggestions', async () => {
        geolocation((success) => success({ coords: { latitude: 6.5, longitude: 3.4 } }));
        axiosClient.get.mockResolvedValue({ data: { location: { address: '5 Allen Avenue, Ikeja', latitude: 6.5, longitude: 3.4 } } });
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: /use my current location/i }));
        await waitFor(() => expect(latest.coordinateSource).toBe('DEVICE'));
        await user.click(screen.getByRole('button', { name: 'Remove precise position' }));
        expect(latest).toEqual({ address: '5 Allen Avenue, Ikeja' });
        expect(screen.queryByRole('button', { name: 'Remove precise position' })).not.toBeInTheDocument();
    });

    it('prefills the address from a successful device lookup', async () => {
        geolocation((success) => success({ coords: { latitude: 6.5, longitude: 3.4 } }));
        axiosClient.get.mockResolvedValue({ data: { location: { address: '5 Allen Avenue, Ikeja', latitude: 6.5, longitude: 3.4 } } });
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: /use my current location/i }));
        await waitFor(() => expect(latest).toEqual({ address: '5 Allen Avenue, Ikeja', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' }));
    });

    it('explains a denied permission and keeps the typed address', async () => {
        geolocation((_success, failure) => failure({ code: 1 }));
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(screen.getByLabelText('Location'), 'Oj');
        await act(async () => { await user.click(screen.getByRole('button', { name: /use my current location/i })); });
        expect(screen.getByText('Location permission was denied — type the address instead.')).toBeInTheDocument();
        expect(latest).toEqual({ address: 'Oj' });
    });

    it('serialises only complete coordinate pairs', () => {
        expect(locationToJson({ address: '  Market  ' })).toEqual({ address: 'Market' });
        expect(locationToJson({ address: 'Market', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' }))
            .toEqual({ address: 'Market', latitude: 6.5, longitude: 3.4, coordinateSource: 'DEVICE' });
        const form = locationToFormData(new FormData(), { address: 'Market', latitude: 6.5, longitude: 3.4, coordinateSource: 'SUGGESTION' });
        expect(Object.fromEntries(form.entries())).toEqual({ address: 'Market', latitude: '6.5', longitude: '3.4', coordinateSource: 'SUGGESTION' });
    });
});
