const { StatusCodes } = require('http-status-codes');
const locationService = require('../services/locationService');

const autocomplete = async (req, res) => {
    const { input, latitude, longitude } = req.query;
    const predictions = await locationService.autocomplete(input, { latitude, longitude });
    res.status(StatusCodes.OK).json({ predictions });
};

const geocode = async (req, res) => {
    const { address, latitude, longitude } = req.query;

    if (latitude !== undefined && longitude !== undefined) {
        const resolvedAddress = await locationService.reverseGeocode(latitude, longitude);
        return res.status(StatusCodes.OK).json({ location: { address: resolvedAddress, latitude: Number(latitude), longitude: Number(longitude) } });
    }

    const result = await locationService.geocodeAddress(address);
    res.status(StatusCodes.OK).json({ location: result });
};

module.exports = { autocomplete, geocode };
