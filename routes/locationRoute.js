const express = require('express');
const LocationRouter = express.Router();
const { authentication } = require('../middleware/auth');
const { autocomplete, geocode } = require('../controllers/locationController');

LocationRouter.route('/autocomplete').get(authentication, autocomplete);
LocationRouter.route('/geocode').get(authentication, geocode);

module.exports = LocationRouter;
