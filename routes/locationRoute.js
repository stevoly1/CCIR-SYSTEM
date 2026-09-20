const express = require('express');
const LocationRouter = express.Router();
const { authentication } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { autocompleteQuerySchema, geocodeQuerySchema } = require('../validators/commonValidator');
const { autocomplete, geocode } = require('../controllers/locationController');

LocationRouter.route('/autocomplete').get(authentication, validate({ query: autocompleteQuerySchema }), autocomplete);
LocationRouter.route('/geocode').get(authentication, validate({ query: geocodeQuerySchema }), geocode);

module.exports = LocationRouter;
