// backend/src/routes/deviceRoutes.js (Phase 1A-2): device-ready storage and saved routes
const express = require('express');
const authenticate = require('../middleware/auth');
const dc = require('../controllers/deviceController');

const device = express.Router();
device.use(authenticate);
device.get('/:type/:id',          dc.getDevice);
device.put('/:type/:id',          dc.putDevice);
device.get('/:type/:id/samples',  dc.getSamples);
device.post('/:type/:id/samples', dc.postSamples);

const savedRoutes = express.Router();
savedRoutes.use(authenticate);
savedRoutes.get('/',            dc.listRoutes);
savedRoutes.post('/',           dc.createRoute);
savedRoutes.get('/:id',         dc.getRoute);
savedRoutes.put('/:id',         dc.updateRoute);
savedRoutes.delete('/:id',      dc.deleteRoute);
savedRoutes.post('/:id/apply',  dc.applyRoute);

module.exports = { device, savedRoutes };
