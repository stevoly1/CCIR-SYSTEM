// Location value shared by LocationField and its forms:
// { address, latitude?, longitude?, coordinateSource? } — coordinates only as a sourced pair.
export const EMPTY_LOCATION = { address: '' };

export const locationToJson = (location) => {
    const body = { address: location.address.trim() };
    if (typeof location.latitude === 'number' && typeof location.longitude === 'number') {
        Object.assign(body, {
            latitude: location.latitude,
            longitude: location.longitude,
            coordinateSource: location.coordinateSource,
        });
    }
    return body;
};

export const locationToFormData = (formData, location) => {
    Object.entries(locationToJson(location)).forEach(([key, value]) => formData.append(key, value));
    return formData;
};
