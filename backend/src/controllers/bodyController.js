// backend/src/controllers/bodyController.js
// Phase 1B-2: body measurements (user_metrics), weight reminders (in-app
// only) and habit calendar stickers.
//
// Measurements are stored metric (kg, cm) and read and written in the user's
// units: users.units_weight 'kg' = metric (kg, cm); anything else, including
// the default 'lbs', = imperial (lb, in). A request may send units:
// 'metric' | 'imperial' to override that for its own values.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { todayIn, addDays, weekdayMon0 } = require('../utils/programSchedule');

function fail(res, err, what) {
  if ([400, 404, 409].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const round2 = n => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);

const UNITS = {
  metric: { system: 'metric', weight: 'kg', length: 'cm', toKg: 1, toCm: 1 },
  imperial: { system: 'imperial', weight: 'lb', length: 'in', toKg: KG_PER_LB, toCm: CM_PER_IN },
};

async function userInfo(db, uid) {
  const r = await db.query(
    `SELECT units_weight, timezone, weight_reminder_mode, weight_reminder_every_days, weight_reminder_weekdays,
            to_char(weight_reminder_anchor, 'YYYY-MM-DD') AS weight_reminder_anchor,
            to_char(weight_reminder_dismissed_on, 'YYYY-MM-DD') AS weight_reminder_dismissed_on
     FROM users WHERE id = $1`, [uid]);
  return r.rows[0];
}
const unitsOf = info => (info?.units_weight === 'kg' ? UNITS.metric : UNITS.imperial);
function unitsArg(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = V.take(V.oneOf(raw, 'units', ['metric', 'imperial'], { required: true }));
  return UNITS[v];
}

// API field → stored column, kind, and the allowed metric range
const PARTS = {
  weight:         { col: 'weight_kg',      kind: 'weight', min: 10, max: 500 },
  body_fat_pct:   { col: 'body_fat_pct',   kind: 'pct',    min: 1,  max: 75 },
  neck:           { col: 'neck_cm',        kind: 'length', min: 5,  max: 300 },
  shoulders:      { col: 'shoulders_cm',   kind: 'length', min: 5,  max: 300 },
  chest:          { col: 'chest_cm',       kind: 'length', min: 5,  max: 300 },
  waist:          { col: 'waist_cm',       kind: 'length', min: 5,  max: 300 },
  hips:           { col: 'hips_cm',        kind: 'length', min: 5,  max: 300 },
  arm_left:       { col: 'arm_left_cm',    kind: 'length', min: 5,  max: 300 },
  arm_right:      { col: 'arm_right_cm',   kind: 'length', min: 5,  max: 300 },
  thigh_left:     { col: 'thigh_left_cm',  kind: 'length', min: 5,  max: 300 },
  thigh_right:    { col: 'thigh_right_cm', kind: 'length', min: 5,  max: 300 },
  calf_left:      { col: 'calf_left_cm',   kind: 'length', min: 5,  max: 300 },
  calf_right:     { col: 'calf_right_cm',  kind: 'length', min: 5,  max: 300 },
};
const OTHER_FIELDS = ['metric_date', 'measured_at', 'notes', 'scan_method', 'units'];

/** One API value (in units u) → the stored metric value; null clears. */
function toStored(field, raw, u) {
  const p = PARTS[field];
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (typeof raw === 'boolean' || !Number.isFinite(n)) throw V.badRequest(`${field} must be a number`);
  const factor = p.kind === 'weight' ? u.toKg : p.kind === 'length' ? u.toCm : 1;
  const stored = Math.round(n * factor * 1000) / 1000;
  if (stored < p.min || stored > p.max) {
    const unit = p.kind === 'weight' ? u.weight : p.kind === 'length' ? u.length : '%';
    const lo = round2(p.min / factor), hi = round2(p.max / factor);
    throw V.badRequest(`${field} must be from ${lo} to ${hi} ${unit}`);
  }
  return stored;
}
function fromStored(field, v, u) {
  if (v === null || v === undefined) return null;
  const p = PARTS[field];
  const factor = p.kind === 'weight' ? u.toKg : p.kind === 'length' ? u.toCm : 1;
  return round2(Number(v) / factor);
}

function measurementOut(row, u) {
  const out = {
    id: row.id, metric_date: row.metric_date_text, measured_at: row.measured_at,
    units: { system: u.system, weight: u.weight, length: u.length },
  };
  for (const f of Object.keys(PARTS)) out[f] = fromStored(f, row[PARTS[f].col], u);
  out.metric = Object.fromEntries(Object.values(PARTS).map(p => [p.col, row[p.col] === null ? null : Number(row[p.col])]));
  out.notes = row.notes;
  out.scan_method = row.scan_method;
  out.body_composition = row.body_composition;   // older free-form data (migration 001), kept as is
  out.created_at = row.created_at;
  out.updated_at = row.updated_at;
  return out;
}
const M_SELECT = `SELECT *, to_char(metric_date, 'YYYY-MM-DD') AS metric_date_text FROM user_metrics`;

function measuredAtArg(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (Number.isNaN(t)) throw V.badRequest('measured_at must be a date-time (ISO 8601)');
  return new Date(t).toISOString();
}

/** Validated column values from a body (only the keys sent). */
function measurementFields(b, u, today) {
  const unknown = Object.keys(b).filter(k => !(k in PARTS) && !OTHER_FIELDS.includes(k));
  if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${[...Object.keys(PARTS), ...OTHER_FIELDS].join(', ')}`);
  const cols = {};
  for (const f of Object.keys(PARTS)) if (f in b) cols[PARTS[f].col] = toStored(f, b[f], u);
  if ('metric_date' in b) {
    const d = V.take(V.dateStr(b.metric_date, 'metric_date', { required: true }));
    if (d > addDays(today, 1)) throw V.badRequest('metric_date cannot be in the future');
    cols.metric_date = d;
  }
  if ('measured_at' in b) cols.measured_at = measuredAtArg(b.measured_at);
  if ('notes' in b) cols.notes = V.take(V.text(b.notes, 'notes', 2000));
  if ('scan_method' in b) cols.scan_method = V.take(V.text(b.scan_method, 'scan_method', 100));
  return cols;
}
const hasValue = row => Object.values(PARTS).some(p => row[p.col] !== null && row[p.col] !== undefined);

// GET /body/measurements?from=&to=
const listMeasurements = async (req, res) => {
  const uid = req.user.userId;
  try {
    const u = unitsArg(req.query.units, unitsOf(await userInfo(pool, uid)));
    const from = V.take(V.dateStr(req.query.from, 'from'));
    const to = V.take(V.dateStr(req.query.to, 'to'));
    if (from && to && to < from) throw V.badRequest('to must be on or after from');
    const r = await pool.query(
      `${M_SELECT} WHERE user_id = $1 AND ($2::date IS NULL OR metric_date >= $2) AND ($3::date IS NULL OR metric_date <= $3)
       ORDER BY metric_date DESC, COALESCE(measured_at, created_at) DESC, id DESC`,
      [uid, from, to]
    );
    res.json({ units: { system: u.system, weight: u.weight, length: u.length }, measurements: r.rows.map(row => measurementOut(row, u)) });
  } catch (err) { fail(res, err, 'list measurements'); }
};

// POST /body/measurements  { metric_date?, measured_at?, weight?, body_fat_pct?, neck?, ..., notes?, scan_method?, units? }
const createMeasurement = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const info = await userInfo(pool, uid);
    const u = unitsArg(b.units, unitsOf(info));
    const today = todayIn(info.timezone);
    const cols = measurementFields(b, u, today);
    if (!hasValue(cols)) throw V.badRequest('Send at least one value (weight, body_fat_pct or a measurement)');
    if (!cols.metric_date) cols.metric_date = today;
    const keys = Object.keys(cols);
    const r = await pool.query(
      `INSERT INTO user_metrics (user_id, ${keys.join(', ')}, updated_at) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
       RETURNING *, to_char(metric_date, 'YYYY-MM-DD') AS metric_date_text`,
      [uid, ...keys.map(k => cols[k])]
    );
    res.status(201).json({ measurement: measurementOut(r.rows[0], unitsOf(info)) });
  } catch (err) { fail(res, err, 'save measurement'); }
};

async function ownMeasurement(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  return (await db.query(`${M_SELECT} WHERE id = $1 AND user_id = $2`, [n, uid])).rows[0] || null;
}

const getMeasurement = async (req, res) => {
  const uid = req.user.userId;
  try {
    const u = unitsArg(req.query.units, unitsOf(await userInfo(pool, uid)));
    const row = await ownMeasurement(pool, req.params.id, uid);
    if (!row) throw httpError(404, 'Measurement not found');
    res.json({ measurement: measurementOut(row, u) });
  } catch (err) { fail(res, err, 'get measurement'); }
};

// PUT /body/measurements/:id — only the keys sent change; null clears a value
const updateMeasurement = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const info = await userInfo(pool, uid);
    const u = unitsArg(b.units, unitsOf(info));
    const cur = await ownMeasurement(pool, req.params.id, uid);
    if (!cur) throw httpError(404, 'Measurement not found');
    const cols = measurementFields(b, u, todayIn(info.timezone));
    const next = { ...cur, ...cols };
    if (!hasValue(next) && !cur.body_composition) throw V.badRequest('A measurement needs at least one value; DELETE it instead');
    const keys = Object.keys(cols);
    if (!keys.length) return res.json({ measurement: measurementOut(cur, unitsOf(info)) });
    const r = await pool.query(
      `UPDATE user_metrics SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *, to_char(metric_date, 'YYYY-MM-DD') AS metric_date_text`,
      [cur.id, uid, ...keys.map(k => cols[k])]
    );
    res.json({ measurement: measurementOut(r.rows[0], unitsOf(info)) });
  } catch (err) { fail(res, err, 'update measurement'); }
};

const deleteMeasurement = async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const r = id ? await pool.query(`DELETE FROM user_metrics WHERE id = $1 AND user_id = $2 RETURNING id`, [id, req.user.userId]) : { rows: [] };
    if (!r.rows.length) throw httpError(404, 'Measurement not found');
    res.json({ message: 'Measurement deleted', id });
  } catch (err) { fail(res, err, 'delete measurement'); }
};

// ═════════════════════════════════════════════════════════════════════════════
// Weight reminders (in-app only: no email, no push)
// ═════════════════════════════════════════════════════════════════════════════
// every_n_days: due once N days have passed since the last weigh-in (a
// user_metrics row with a weight), or since the schedule was saved when there
// is none. weekdays: due on a chosen weekday until a weigh-in that day.
// Dismissing hides the reminder for the rest of that day.

function reminderSettingsOut(info) {
  return {
    mode: info.weight_reminder_mode,
    every_days: info.weight_reminder_every_days,
    weekdays: info.weight_reminder_weekdays || null,
    anchor_date: info.weight_reminder_anchor,
    dismissed_on: info.weight_reminder_dismissed_on,
  };
}

const getReminderSettings = async (req, res) => {
  try { res.json({ weight_reminder: reminderSettingsOut(await userInfo(pool, req.user.userId)) }); }
  catch (err) { fail(res, err, 'get reminder settings'); }
};

// PUT /body/weight-reminder  { mode: off|every_n_days|weekdays, every_days? (1-90), weekdays? ([0-6], 0 = Mon) }
const putReminderSettings = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const unknown = Object.keys(b).filter(k => !['mode', 'every_days', 'weekdays'].includes(k));
    if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: mode, every_days, weekdays`);
    const mode = V.take(V.oneOf(b.mode, 'mode', ['off', 'every_n_days', 'weekdays'], { required: true }));
    let every = null, days = null;
    if (mode === 'every_n_days') every = V.take(V.intIn(b.every_days, 'every_days', 1, 90, { required: true }));
    else if (b.every_days !== undefined && b.every_days !== null) throw V.badRequest('every_days is only for mode every_n_days');
    if (mode === 'weekdays') {
      if (!Array.isArray(b.weekdays) || !b.weekdays.length) throw V.badRequest('weekdays must be a list of days, 0 = Monday … 6 = Sunday');
      days = [...new Set(b.weekdays.map((d, i) => V.take(V.intIn(d, `weekdays[${i}]`, 0, 6, { required: true }))))].sort();
    } else if (b.weekdays !== undefined && b.weekdays !== null) throw V.badRequest('weekdays is only for mode weekdays');
    const info = await userInfo(pool, uid);
    await pool.query(
      `UPDATE users SET weight_reminder_mode = $2, weight_reminder_every_days = $3, weight_reminder_weekdays = $4,
         weight_reminder_anchor = CASE WHEN $2 = 'off' THEN NULL ELSE $5::date END, weight_reminder_dismissed_on = NULL
       WHERE id = $1`,
      [uid, mode, every, days, todayIn(info.timezone)]
    );
    res.json({ weight_reminder: reminderSettingsOut(await userInfo(pool, uid)) });
  } catch (err) { fail(res, err, 'save reminder settings'); }
};

/** The reminders due on a date (the user's today by default). */
async function dueReminders(db, uid, date) {
  const info = await userInfo(db, uid);
  const mode = info.weight_reminder_mode;
  if (!mode || mode === 'off') return [];
  if (info.weight_reminder_dismissed_on === date) return [];
  const last = (await db.query(
    `SELECT to_char(MAX(metric_date), 'YYYY-MM-DD') AS d FROM user_metrics WHERE user_id = $1 AND weight_kg IS NOT NULL AND metric_date <= $2`,
    [uid, date]
  )).rows[0].d;
  const base = { type: 'weight', mode, last_weighed_on: last, message: 'Time to log your weight.' };
  if (mode === 'every_n_days') {
    const n = info.weight_reminder_every_days;
    const from = last || info.weight_reminder_anchor;
    const dueOn = from ? addDays(from, n) : date;
    return date >= dueOn ? [{ ...base, every_days: n, due_since: dueOn }] : [];
  }
  const days = info.weight_reminder_weekdays || [];
  if (days.includes(weekdayMon0(date)) && last !== date) return [{ ...base, weekdays: days, due_since: date }];
  return [];
}

// GET /body/reminders/due?date= (optional; default the user's today)
const getDueReminders = async (req, res) => {
  const uid = req.user.userId;
  try {
    const info = await userInfo(pool, uid);
    const date = V.take(V.dateStr(req.query.date, 'date')) || todayIn(info.timezone);
    res.json({ date, reminders: await dueReminders(pool, uid, date) });
  } catch (err) { fail(res, err, 'get reminders'); }
};

// POST /body/reminders/weight/dismiss — hides today's weight reminder
const dismissWeightReminder = async (req, res) => {
  const uid = req.user.userId;
  try {
    const info = await userInfo(pool, uid);
    const today = todayIn(info.timezone);
    await pool.query(`UPDATE users SET weight_reminder_dismissed_on = $2 WHERE id = $1`, [uid, today]);
    res.json({ dismissed_on: today });
  } catch (err) { fail(res, err, 'dismiss reminder'); }
};

// ═════════════════════════════════════════════════════════════════════════════
// Habit calendar stickers
// ═════════════════════════════════════════════════════════════════════════════

const ST_SELECT = `SELECT s.*, to_char(s.sticker_date, 'YYYY-MM-DD') AS date_text, h.name AS habit_name
                   FROM calendar_stickers s LEFT JOIN habits h ON h.id = s.habit_id`;
const stickerOut = r => ({
  id: r.id, date: r.date_text, sticker: r.sticker, note: r.note, habit_id: r.habit_id, habit_name: r.habit_name,
  created_at: r.created_at, updated_at: r.updated_at,
});

async function habitArg(db, raw, uid) {
  if (raw === null) return null;
  const id = V.take(V.intIn(raw, 'habit_id', 1, 2147483647, { required: true }));
  const r = await db.query(`SELECT id FROM habits WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!r.rows.length) throw V.badRequest('habit_id is not one of your habits');
  return id;
}
function stickerText(raw) {
  const t = V.take(V.text(raw, 'sticker', 200, { required: true }));
  if ([...t].length > 32) throw V.badRequest('sticker must be at most 32 characters (an emoji or a short label)');
  return t;
}
const STICKER_FIELDS = ['date', 'sticker', 'note', 'habit_id'];

// GET /stickers?from=&to= (both required, at most 366 days)
const listStickers = async (req, res) => {
  try {
    const from = V.take(V.dateStr(req.query.from, 'from', { required: true }));
    const to = V.take(V.dateStr(req.query.to, 'to', { required: true }));
    if (to < from) throw V.badRequest('to must be on or after from');
    if (to > addDays(from, 365)) throw V.badRequest('A range can be at most 366 days');
    const r = await pool.query(`${ST_SELECT} WHERE s.user_id = $1 AND s.sticker_date BETWEEN $2 AND $3 ORDER BY s.sticker_date, s.id`, [req.user.userId, from, to]);
    res.json({ from, to, stickers: r.rows.map(stickerOut) });
  } catch (err) { fail(res, err, 'list stickers'); }
};

// POST /stickers  { date, sticker, note?, habit_id? }
const createSticker = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const unknown = Object.keys(b).filter(k => !STICKER_FIELDS.includes(k));
    if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${STICKER_FIELDS.join(', ')}`);
    const date = V.take(V.dateStr(b.date, 'date', { required: true }));
    const sticker = stickerText(b.sticker);
    const note = V.take(V.text(b.note, 'note', 1000));
    const habitId = b.habit_id === undefined ? null : await habitArg(pool, b.habit_id, uid);
    const r = await pool.query(
      `INSERT INTO calendar_stickers (user_id, sticker_date, sticker, note, habit_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [uid, date, sticker, note, habitId]
    );
    const row = (await pool.query(`${ST_SELECT} WHERE s.id = $1`, [r.rows[0].id])).rows[0];
    res.status(201).json({ sticker: stickerOut(row) });
  } catch (err) { fail(res, err, 'save sticker'); }
};

async function ownSticker(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  return (await db.query(`${ST_SELECT} WHERE s.id = $1 AND s.user_id = $2`, [n, uid])).rows[0] || null;
}

const getSticker = async (req, res) => {
  try {
    const row = await ownSticker(pool, req.params.id, req.user.userId);
    if (!row) throw httpError(404, 'Sticker not found');
    res.json({ sticker: stickerOut(row) });
  } catch (err) { fail(res, err, 'get sticker'); }
};

// PUT /stickers/:id — only the keys sent change; habit_id: null unlinks
const updateSticker = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const unknown = Object.keys(b).filter(k => !STICKER_FIELDS.includes(k));
    if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${STICKER_FIELDS.join(', ')}`);
    const cur = await ownSticker(pool, req.params.id, uid);
    if (!cur) throw httpError(404, 'Sticker not found');
    const date = 'date' in b ? V.take(V.dateStr(b.date, 'date', { required: true })) : cur.date_text;
    const sticker = 'sticker' in b ? stickerText(b.sticker) : cur.sticker;
    const note = 'note' in b ? V.take(V.text(b.note, 'note', 1000)) : cur.note;
    const habitId = 'habit_id' in b ? await habitArg(pool, b.habit_id, uid) : cur.habit_id;
    await pool.query(
      `UPDATE calendar_stickers SET sticker_date = $3, sticker = $4, note = $5, habit_id = $6, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [cur.id, uid, date, sticker, note, habitId]
    );
    res.json({ sticker: stickerOut(await ownSticker(pool, cur.id, uid)) });
  } catch (err) { fail(res, err, 'update sticker'); }
};

const deleteSticker = async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const r = id ? await pool.query(`DELETE FROM calendar_stickers WHERE id = $1 AND user_id = $2 RETURNING id`, [id, req.user.userId]) : { rows: [] };
    if (!r.rows.length) throw httpError(404, 'Sticker not found');
    res.json({ message: 'Sticker deleted', id });
  } catch (err) { fail(res, err, 'delete sticker'); }
};

module.exports = {
  listMeasurements, createMeasurement, getMeasurement, updateMeasurement, deleteMeasurement,
  getReminderSettings, putReminderSettings, getDueReminders, dismissWeightReminder, dueReminders,
  listStickers, createSticker, getSticker, updateSticker, deleteSticker,
};
