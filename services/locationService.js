const { locationProviderUnavailable } = require('../errors/domainErrors');

const PHOTON_BASE_URL = 'https://photon.komoot.io';

const parseLocationTimeout = (value) => {
    if (value === undefined || value === '') return 4000;
    const timeout = Number(value);
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 10000) {
        throw new Error('LOCATION_TIMEOUT_MS must be an integer between 1000 and 10000');
    }
    return timeout;
};

const LOCATION_TIMEOUT_MS = parseLocationTimeout(process.env.LOCATION_TIMEOUT_MS);

// Builds a human-readable label from a Photon GeoJSON feature's properties.
const formatLabel = (properties = {}) => {
    const { name, housenumber, street, city, state, country, postcode } = properties;

    const line1 = [street, housenumber].filter(Boolean).join(' ');
    const parts = [name && name !== line1 ? name : null, line1 || null, city, state, postcode, country];

    return [...new Set(parts.filter(Boolean))].join(', ');
};

const hasValidCoordinates = (feature) => {
    const [longitude, latitude] = feature?.geometry?.coordinates ?? [];
    return Number.isFinite(longitude) && Number.isFinite(latitude)
        && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
};

const toLocation = (feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    return { address: formatLabel(feature.properties), latitude, longitude };
};

// Photon (photon.komoot.io) — free, keyless OSM-based geocoder. Every call is bounded by
// LOCATION_TIMEOUT_MS; any timeout, network, HTTP, or format failure becomes a typed 503.
const requestFeatures = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOCATION_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw locationProviderUnavailable();
        const data = await response.json();
        if (!data || !Array.isArray(data.features)) throw locationProviderUnavailable();
        return data.features;
    } catch (error) {
        if (error?.code === 'LOCATION_PROVIDER_UNAVAILABLE') throw error;
        throw locationProviderUnavailable();
    } finally {
        clearTimeout(timer);
    }
};

const autocomplete = async (input, { latitude, longitude } = {}) => {
    const url = new URL(`${PHOTON_BASE_URL}/api/`);
    url.searchParams.set('q', input);
    url.searchParams.set('limit', '5');
    if (latitude !== undefined && longitude !== undefined) {
        url.searchParams.set('lat', latitude);
        url.searchParams.set('lon', longitude);
    }
    const features = await requestFeatures(url);
    return features.filter(hasValidCoordinates).map((feature) => {
        const location = toLocation(feature);
        return { label: location.address, ...location };
    });
};

// Forward geocode a free-text address into coordinates; `null` when nothing matches.
const geocodeAddress = async (address) => {
    const url = new URL(`${PHOTON_BASE_URL}/api/`);
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');
    const feature = (await requestFeatures(url)).find(hasValidCoordinates);
    return feature ? toLocation(feature) : null;
};

// Reverse geocode raw coordinates (e.g. from a device GPS) into a formatted address.
const reverseGeocode = async (latitude, longitude) => {
    const url = new URL(`${PHOTON_BASE_URL}/reverse`);
    url.searchParams.set('lat', latitude);
    url.searchParams.set('lon', longitude);
    const [feature] = await requestFeatures(url);
    return feature ? (formatLabel(feature.properties) || null) : null;
};

module.exports = { parseLocationTimeout, autocomplete, geocodeAddress, reverseGeocode };
