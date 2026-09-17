const { StatusCodes } = require('http-status-codes');
const CustomError = require('../errors');
const locationService = require('../services/locationService');

const autocomplete = async (req, res) => {
    const { input, latitude, longitude } = req.query;
    if (!input) throw new CustomError.BadRequestError('Query param "input" is required');

    const predictions = await locationService.autocomplete(input, { latitude, longitude });
    res.status(StatusCodes.OK).json({ predictions });
};

const geocode = async (req, res) => {
    const { address, latitude, longitude } = req.query;

    if (latitude !== undefined && longitude !== undefined) {
        const resolvedAddress = await locationService.reverseGeocode(latitude, longitude);
        return res.status(StatusCodes.OK).json({ location: { address: resolvedAddress, latitude: Number(latitude), longitude: Number(longitude) } });
    }

    if (!address) {
        throw new CustomError.BadRequestError('Query param "address" or "latitude"/"longitude" is required');
    }

    const result = await locationService.geocodeAddress(address);
    res.status(StatusCodes.OK).json({ location: result });
};

module.exports = { autocomplete, geocode };
