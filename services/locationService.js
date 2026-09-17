const PHOTON_BASE_URL = 'https://photon.komoot.io';

// Builds a human-readable label from a Photon GeoJSON feature's properties.
const formatLabel = (properties) => {
    const { name, housenumber, street, city, state, country, postcode } = properties;

    const line1 = [street, housenumber].filter(Boolean).join(' ');
    const parts = [name && name !== line1 ? name : null, line1 || null, city, state, postcode, country];

    return [...new Set(parts.filter(Boolean))].join(', ');
};

const featureToLocation = (feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    return {
        address: formatLabel(feature.properties),
        latitude,
        longitude,
    };
};

// Photon (photon.komoot.io) — free, keyless OSM-based geocoder. Used for both
// citizen-facing address autocomplete and forward/reverse geocoding.
const autocomplete = async (input, { latitude, longitude } = {}) => {
    const url = new URL(`${PHOTON_BASE_URL}/api/`);
    url.searchParams.set('q', input);
    url.searchParams.set('limit', '5');
    if (latitude !== undefined && longitude !== undefined) {
        url.searchParams.set('lat', latitude);
        url.searchParams.set('lon', longitude);
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Photon autocomplete failed (${response.status})`);
    }
    const data = await response.json();

    return (data.features || []).map((feature) => ({
        label: formatLabel(feature.properties),
        ...featureToLocation(feature),
    }));
};

// Forward geocode a free-text address into coordinates.
const geocodeAddress = async (address) => {
    const url = new URL(`${PHOTON_BASE_URL}/api/`);
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Photon geocoding failed (${response.status})`);
    }
    const data = await response.json();

    if (!data.features?.[0]) {
        throw new Error('No matching location found');
    }

    return featureToLocation(data.features[0]);
};

// Reverse geocode raw coordinates (e.g. from a device GPS) into a formatted address.
const reverseGeocode = async (latitude, longitude) => {
    const url = new URL(`${PHOTON_BASE_URL}/reverse`);
    url.searchParams.set('lat', latitude);
    url.searchParams.set('lon', longitude);

    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();

    if (!data.features?.[0]) return null;
    return formatLabel(data.features[0].properties);
};

module.exports = { autocomplete, geocodeAddress, reverseGeocode };
