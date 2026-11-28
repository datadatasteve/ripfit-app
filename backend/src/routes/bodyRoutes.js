// backend/src/routes/bodyRoutes.js (Phase 1B-2)
// /api/v1/body: measurements and weight reminders. /api/v1/stickers: habit calendar stickers.
const express = require('express');
const authenticate = require('../middleware/auth');
const bc = require('../controllers/bodyController');

const body = express.Router();
body.use(authenticate);
body.get('/measurements',               bc.listMeasurements);
body.post('/measurements',              bc.createMeasurement);
body.get('/measurements/:id',           bc.getMeasurement);
body.put('/measurements/:id',           bc.updateMeasurement);
body.delete('/measurements/:id',        bc.deleteMeasurement);
body.get('/weight-reminder',            bc.getReminderSettings);
body.put('/weight-reminder',            bc.putReminderSettings);
body.get('/reminders/due',              bc.getDueReminders);
body.post('/reminders/weight/dismiss',  bc.dismissWeightReminder);

const stickers = express.Router();
stickers.use(authenticate);
stickers.get('/',       bc.listStickers);
stickers.post('/',      bc.createSticker);
stickers.get('/:id',    bc.getSticker);
stickers.put('/:id',    bc.updateSticker);
stickers.delete('/:id', bc.deleteSticker);

module.exports = { body, stickers };
