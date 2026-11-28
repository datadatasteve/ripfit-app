// backend/src/controllers/nutritionExtrasController.js
// Phase 1B-2: barcode / food overrides, the craving log (SAS), and the
// label-submission queue with temporary photos.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { gramsOf } = require('../utils/nutritionCore');
const { todayIn, addDays } = require('../utils/programSchedule');
const { OVERRIDE_COLUMNS, overrideFor, foodForUser } = require('../utils/foodOverride');
const { lookupBarcode } = require('./nutritionController');

function fail(res, err, what) {
  if ([400, 403, 404, 409].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const r2 = n => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);

async function tx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

async function isAdmin(db, uid) {
  const r = await db.query('SELECT is_admin FROM users WHERE id = $1', [uid]);
  return !!r.rows[0]?.is_admin;
}
async function userToday(db, uid) {
  const r = await db.query('SELECT timezone FROM users WHERE id = $1', [uid]);
  return todayIn(r.rows[0]?.timezone);
}

/** A food the user may see: public, or their own (archived hidden). Same rule as 1B-1. */
async function visibleFood(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(
    `SELECT * FROM foods WHERE id = $1 AND archived_at IS NULL
       AND (created_by_user_id IS NULL OR created_by_user_id = $2 OR source <> 'custom')`,
    [n, uid]
  );
  return r.rows[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Food overrides (barcode food override)
// ═════════════════════════════════════════════════════════════════════════════

const OVERRIDE_FIELDS = {
  calories: v => V.numMin(v, 'calories', 0, { max: 900 }),
  protein_g: v => V.numMin(v, 'protein_g', 0, { max: 100 }),
  carbs_g: v => V.numMin(v, 'carbs_g', 0, { max: 100 }),
  fat_g: v => V.numMin(v, 'fat_g', 0, { max: 100 }),
  fiber_g: v => V.numMin(v, 'fiber_g', 0, { max: 100 }),
  sugar_g: v => V.numMin(v, 'sugar_g', 0, { max: 100 }),
  notes: v => V.text(v, 'notes', 1000),
};

function overrideOut(row, food) {
  if (!row) return null;
  const out = { food_id: row.food_id, notes: row.notes, created_at: row.created_at, updated_at: row.updated_at, per: '100g' };
  for (const k of Object.keys(OVERRIDE_COLUMNS)) out[k] = row[k] === null ? null : Number(row[k]);
  if (food) out.food_name = food.name;
  return out;
}

// GET /nutrition/food-overrides
const listOverrides = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, f.name AS food_name, f.brand, f.gtin_upc FROM user_food_overrides o JOIN foods f ON f.id = o.food_id
       WHERE o.user_id = $1 ORDER BY o.updated_at DESC NULLS LAST, o.id DESC`,
      [req.user.userId]
    );
    res.json({ overrides: r.rows.map(row => ({ ...overrideOut(row, { name: row.food_name }), brand: row.brand, gtin_upc: row.gtin_upc })) });
  } catch (err) { fail(res, err, 'list overrides'); }
};

// GET /nutrition/foods/:id/override
const getOverride = async (req, res) => {
  try {
    const food = await visibleFood(pool, req.params.id, req.user.userId);
    if (!food) throw httpError(404, 'Food not found');
    const ov = await overrideFor(pool, req.user.userId, food.id);
    if (!ov) throw httpError(404, 'No override for this food');
    res.json({ override: overrideOut(ov, food) });
  } catch (err) { fail(res, err, 'get override'); }
};

// PUT /nutrition/foods/:id/override  { calories?, protein_g?, carbs_g?, fat_g?, fiber_g?, sugar_g?, notes? } (per 100 g; null = use the food's value)
const putOverride = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const unknown = Object.keys(b).filter(k => !(k in OVERRIDE_FIELDS));
    if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${Object.keys(OVERRIDE_FIELDS).join(', ')}`);
    const food = await visibleFood(pool, req.params.id, uid);
    if (!food) throw httpError(404, 'Food not found');
    const cur = await overrideFor(pool, uid, food.id);
    const next = {};
    for (const k of Object.keys(OVERRIDE_FIELDS)) next[k] = k in b ? V.take(OVERRIDE_FIELDS[k](b[k])) : (cur ? cur[k] : null);
    if (Object.keys(OVERRIDE_COLUMNS).every(k => next[k] === null || next[k] === undefined)) {
      throw V.badRequest('Set at least one value (calories, protein_g, carbs_g, fat_g, fiber_g or sugar_g); to remove the override, DELETE it');
    }
    const cols = Object.keys(OVERRIDE_FIELDS);
    const r = await pool.query(
      `INSERT INTO user_food_overrides (user_id, food_id, ${cols.join(', ')})
       VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')})
       ON CONFLICT (user_id, food_id) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [uid, food.id, ...cols.map(c => next[c])]
    );
    res.status(cur ? 200 : 201).json({ override: overrideOut(r.rows[0], food), food: await foodForUser(pool, food, uid) });
  } catch (err) { fail(res, err, 'save override'); }
};

// DELETE /nutrition/foods/:id/override
const deleteOverride = async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const r = id ? await pool.query(`DELETE FROM user_food_overrides WHERE user_id = $1 AND food_id = $2 RETURNING id`, [req.user.userId, id]) : { rows: [] };
    if (!r.rows.length) throw httpError(404, 'No override for this food');
    res.json({ message: 'Override removed', food_id: id });
  } catch (err) { fail(res, err, 'remove override'); }
};

// GET /nutrition/me/foods/:id — the food as this user sees it (override applied)
const getFoodForMe = async (req, res) => {
  try {
    const food = await visibleFood(pool, req.params.id, req.user.userId);
    if (!food) throw httpError(404, 'Food not found');
    res.json({ food: await foodForUser(pool, food, req.user.userId) });
  } catch (err) { fail(res, err, 'get food'); }
};

// POST /nutrition/me/foods/barcode/:barcode — the existing barcode lookup
// (same steps and answers as the public endpoint), plus the user's override.
const scanBarcodeForMe = async (req, res) => {
  try {
    const out = await lookupBarcode(req.params.barcode);
    if (out.body && out.body.food) out.body = { ...out.body, food: await foodForUser(pool, out.body.food, req.user.userId) };
    res.status(out.status).json(out.body);
  } catch (err) { fail(res, err, 'scan barcode'); }
};

// ═════════════════════════════════════════════════════════════════════════════
// Craving log (SAS)
// ═════════════════════════════════════════════════════════════════════════════
// An entry stores the food, the portion and the values it carried at the time
// (calories, fat, sugar, with the user's override applied), so later edits to
// the food never rewrite it. avoided defaults to true; "had it" is avoided:false.

const CRAVING_UNITS = ['g', 'ml', 'oz', 'lb', 'kg', 'serving'];

function portionGrams(food, amount, unit) {
  if (unit === 'serving') {
    const size = Number(food.serving_size) || 100;
    return amount * gramsOf(size, food.serving_unit || 'g');
  }
  return gramsOf(amount, unit);
}
function valuesFor(food, grams) {
  const f = grams / 100;
  return {
    grams: r2(grams),
    calories: r2(Number(food.calories_per_100g || 0) * f),
    fat_g: r2(Number(food.fat_per_100g || 0) * f),
    sugar_g: r2(Number(food.sugar_per_100g || 0) * f),
  };
}
function cravingOut(row) {
  return {
    id: row.id, food_id: row.food_id, food_name: row.food_name, barcode: row.barcode,
    amount: Number(row.amount), unit: row.unit, grams: r2(row.grams),
    calories: r2(row.calories), fat_g: r2(row.fat_g), sugar_g: r2(row.sugar_g),
    note: row.note, logged_at: row.logged_at, log_date: row.log_date_text || row.log_date,
    avoided: row.avoided, created_at: row.created_at, updated_at: row.updated_at,
  };
}
const CRAVING_SELECT = `SELECT *, to_char(log_date, 'YYYY-MM-DD') AS log_date_text FROM craving_logs`;

function timestampArg(raw, field) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw V.badRequest(`${field} must be a date-time (ISO 8601)`);
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw V.badRequest(`${field} must be a date-time (ISO 8601)`);
  if (t > Date.now() + 5 * 60 * 1000) throw V.badRequest(`${field} cannot be in the future`);
  return new Date(t).toISOString();
}

/** The user's calendar date of a timestamp (their time zone; UTC when unknown). */
async function localDate(db, uid, iso) {
  const r = await db.query(
    `SELECT to_char(($2::timestamptz AT TIME ZONE COALESCE((SELECT timezone FROM users WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`,
    [uid, iso]
  );
  return r.rows[0].d;
}

/** Food for a craving: by food_id, or by barcode (the same lookup as scanning). */
async function cravingFood(db, uid, b) {
  if (b.food_id !== undefined && b.food_id !== null && b.food_id !== '') {
    const food = await visibleFood(db, V.take(V.intIn(b.food_id, 'food_id', 1, 2147483647)), uid);
    if (!food) throw httpError(404, 'Food not found');
    return { food: await foodForUser(db, food, uid), barcode: b.barcode ? V.take(V.text(b.barcode, 'barcode', 20)) : food.gtin_upc || null };
  }
  if (b.barcode) {
    const code = V.take(V.text(String(b.barcode), 'barcode', 20));
    if (!/^\d{6,20}$/.test(code)) throw V.badRequest('barcode must be 6 to 20 digits');
    const out = await lookupBarcode(code);
    if (!out.body?.food) throw httpError(404, 'Barcode not found');
    return { food: await foodForUser(db, out.body.food, uid), barcode: code };
  }
  throw V.badRequest('food_id or barcode is required');
}

// POST /nutrition/cravings  { food_id | barcode, amount, unit?, note?, logged_at?, avoided? }
const createCraving = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const amount = V.take(V.numMin(b.amount, 'amount', 0.01, { required: true, max: 100000 }));
    const unit = V.take(V.oneOf(b.unit ?? 'g', 'unit', CRAVING_UNITS, { required: true }));
    const note = V.take(V.text(b.note, 'note', 1000));
    const avoided = b.avoided === undefined ? true : V.take(V.bool(b.avoided, 'avoided'));
    if (avoided === null) throw V.badRequest('avoided must be true or false');
    const loggedAt = timestampArg(b.logged_at, 'logged_at') || new Date().toISOString();
    const { food, barcode } = await cravingFood(pool, uid, b);
    const vals = valuesFor(food, portionGrams(food, amount, unit));
    const logDate = await localDate(pool, uid, loggedAt);
    const r = await pool.query(
      `INSERT INTO craving_logs (user_id, food_id, food_name, barcode, amount, unit, grams, calories, fat_g, sugar_g, note, logged_at, log_date, avoided)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *, to_char(log_date, 'YYYY-MM-DD') AS log_date_text`,
      [uid, food.id, food.name, barcode, amount, unit, vals.grams, vals.calories, vals.fat_g, vals.sugar_g, note, loggedAt, logDate, avoided]
    );
    res.status(201).json({ craving: cravingOut(r.rows[0]) });
  } catch (err) { fail(res, err, 'log craving'); }
};

// GET /nutrition/cravings?from=&to=&avoided=
const listCravings = async (req, res) => {
  const uid = req.user.userId;
  try {
    const q = req.query;
    const from = V.take(V.dateStr(q.from, 'from'));
    const to = V.take(V.dateStr(q.to, 'to'));
    if (from && to && to < from) throw V.badRequest('to must be on or after from');
    const avoided = q.avoided === undefined ? null : q.avoided === 'true' ? true : q.avoided === 'false' ? false : (() => { throw V.badRequest('avoided must be true or false'); })();
    const r = await pool.query(
      `${CRAVING_SELECT} WHERE user_id = $1 AND ($2::date IS NULL OR log_date >= $2) AND ($3::date IS NULL OR log_date <= $3)
         AND ($4::boolean IS NULL OR avoided = $4)
       ORDER BY logged_at DESC, id DESC`,
      [uid, from, to, avoided]
    );
    res.json({ cravings: r.rows.map(cravingOut) });
  } catch (err) { fail(res, err, 'list cravings'); }
};

async function ownCraving(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`${CRAVING_SELECT} WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0] || null;
}

const getCraving = async (req, res) => {
  try {
    const row = await ownCraving(pool, req.params.id, req.user.userId);
    if (!row) throw httpError(404, 'Craving not found');
    res.json({ craving: cravingOut(row) });
  } catch (err) { fail(res, err, 'get craving'); }
};

// PUT /nutrition/cravings/:id  { amount?, unit?, note?, logged_at?, avoided? }
// A new portion is valued again from the food (with the user's override); if
// the food has since been deleted, the stored values are scaled by grams.
const updateCraving = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const allowed = ['amount', 'unit', 'note', 'logged_at', 'avoided'];
    const unknown = Object.keys(b).filter(k => !allowed.includes(k));
    if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`);
    const cur = await ownCraving(pool, req.params.id, uid);
    if (!cur) throw httpError(404, 'Craving not found');
    const amount = 'amount' in b ? V.take(V.numMin(b.amount, 'amount', 0.01, { required: true, max: 100000 })) : Number(cur.amount);
    const unit = 'unit' in b ? V.take(V.oneOf(b.unit, 'unit', CRAVING_UNITS, { required: true })) : cur.unit;
    const note = 'note' in b ? V.take(V.text(b.note, 'note', 1000)) : cur.note;
    let avoided = cur.avoided;
    if ('avoided' in b) { avoided = V.take(V.bool(b.avoided, 'avoided')); if (avoided === null) throw V.badRequest('avoided must be true or false'); }
    const loggedAt = 'logged_at' in b ? (timestampArg(b.logged_at, 'logged_at') || cur.logged_at.toISOString()) : cur.logged_at.toISOString();
    let vals = { grams: cur.grams, calories: cur.calories, fat_g: cur.fat_g, sugar_g: cur.sugar_g };
    if ('amount' in b || 'unit' in b) {
      const food = cur.food_id ? await foodForUser(pool, (await pool.query('SELECT * FROM foods WHERE id = $1', [cur.food_id])).rows[0] || null, uid) : null;
      if (food) vals = valuesFor(food, portionGrams(food, amount, unit));
      else {
        if (unit === 'serving') throw V.badRequest('This food no longer exists, so its serving size is unknown: use a weight unit');
        const grams = gramsOf(amount, unit);
        const k = Number(cur.grams) > 0 ? grams / Number(cur.grams) : 0;
        vals = { grams: r2(grams), calories: r2(cur.calories * k), fat_g: r2(cur.fat_g * k), sugar_g: r2(cur.sugar_g * k) };
      }
    }
    const logDate = await localDate(pool, uid, loggedAt);
    const r = await pool.query(
      `UPDATE craving_logs SET amount = $3, unit = $4, grams = $5, calories = $6, fat_g = $7, sugar_g = $8, note = $9,
         logged_at = $10, log_date = $11, avoided = $12, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *, to_char(log_date, 'YYYY-MM-DD') AS log_date_text`,
      [cur.id, uid, amount, unit, vals.grams, vals.calories, vals.fat_g, vals.sugar_g, note, loggedAt, logDate, avoided]
    );
    res.json({ craving: cravingOut(r.rows[0]) });
  } catch (err) { fail(res, err, 'update craving'); }
};

const deleteCraving = async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const r = id ? await pool.query(`DELETE FROM craving_logs WHERE id = $1 AND user_id = $2 RETURNING id`, [id, req.user.userId]) : { rows: [] };
    if (!r.rows.length) throw httpError(404, 'Craving not found');
    res.json({ message: 'Craving deleted', id });
  } catch (err) { fail(res, err, 'delete craving'); }
};

/** Totals of the avoided entries (and counts) between two dates, inclusive. */
async function cravingTotals(db, uid, from, to) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS entries,
            COUNT(*) FILTER (WHERE avoided)::int AS avoided_entries,
            COUNT(*) FILTER (WHERE NOT avoided)::int AS had_entries,
            COALESCE(SUM(calories) FILTER (WHERE avoided), 0) AS calories,
            COALESCE(SUM(fat_g) FILTER (WHERE avoided), 0) AS fat_g,
            COALESCE(SUM(sugar_g) FILTER (WHERE avoided), 0) AS sugar_g
     FROM craving_logs WHERE user_id = $1 AND log_date BETWEEN $2 AND $3`,
    [uid, from, to]
  );
  const t = r.rows[0];
  return {
    from, to, entries: t.entries, avoided_entries: t.avoided_entries, had_entries: t.had_entries,
    avoided: { calories: r2(t.calories), fat_g: r2(t.fat_g), sugar_g: r2(t.sugar_g) },
  };
}

// GET /nutrition/cravings/summary?from=&to=  — last 7, 30 and 90 days (ending
// today, the user's date), plus the custom range when from and to are sent.
const cravingSummary = async (req, res) => {
  const uid = req.user.userId;
  try {
    const from = V.take(V.dateStr(req.query.from, 'from'));
    const to = V.take(V.dateStr(req.query.to, 'to'));
    if ((from && !to) || (to && !from)) throw V.badRequest('A custom range needs both from and to');
    if (from && to < from) throw V.badRequest('to must be on or after from');
    const today = await userToday(pool, uid);
    const out = { as_of: today, periods: {} };
    for (const n of [7, 30, 90]) out.periods[`last_${n}_days`] = await cravingTotals(pool, uid, addDays(today, -(n - 1)), today);
    if (from) out.periods.custom = await cravingTotals(pool, uid, from, to);
    res.json(out);
  } catch (err) { fail(res, err, 'summarize cravings'); }
};

// ═════════════════════════════════════════════════════════════════════════════
// Label-submission queue
// ═════════════════════════════════════════════════════════════════════════════
// A user submits a new food or a correction, with up to 3 temporary photos
// (JPEG, PNG or WebP, at most 2 MB each, stored in food_label_photos). Photos
// are deleted when the submission is approved, rejected or expires; pending
// submissions older than 60 days expire when the queue is next read. No food
// photo is ever kept.

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const STALE_DAYS = 60;

const PROPOSED_FIELDS = {
  name: v => V.text(v, 'proposed.name', 255),
  brand: v => V.text(v, 'proposed.brand', 255),
  description: v => V.text(v, 'proposed.description', 2000),
  ingredients: v => V.text(v, 'proposed.ingredients', 5000),
  serving_size: v => V.numMin(v, 'proposed.serving_size', 0.01, { max: 100000 }),
  serving_unit: v => V.oneOf(v, 'proposed.serving_unit', ['g', 'ml', 'oz', 'lb', 'kg']),
  calories_per_100g: v => V.numMin(v, 'proposed.calories_per_100g', 0, { max: 900 }),
  protein_per_100g: v => V.numMin(v, 'proposed.protein_per_100g', 0, { max: 100 }),
  carbs_per_100g: v => V.numMin(v, 'proposed.carbs_per_100g', 0, { max: 100 }),
  fat_per_100g: v => V.numMin(v, 'proposed.fat_per_100g', 0, { max: 100 }),
  fiber_per_100g: v => V.numMin(v, 'proposed.fiber_per_100g', 0, { max: 100 }),
  sugar_per_100g: v => V.numMin(v, 'proposed.sugar_per_100g', 0, { max: 100 }),
  sodium_per_100g: v => V.numMin(v, 'proposed.sodium_per_100g', 0, { max: 9999 }),
};

function proposedArg(raw, { kind }) {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw V.badRequest('proposed must be an object of food values');
  const unknown = Object.keys(raw).filter(k => !(k in PROPOSED_FIELDS));
  if (unknown.length) throw V.badRequest(`proposed has unknown field(s): ${unknown.join(', ')}. Allowed: ${Object.keys(PROPOSED_FIELDS).join(', ')}`);
  const out = {};
  for (const [k, check] of Object.entries(PROPOSED_FIELDS)) {
    const v = V.take(check(raw[k]));
    if (v !== null) out[k] = v;
  }
  if (kind === 'new_food') {
    if (!out.name) throw V.badRequest('proposed.name is required for a new food');
    if (out.calories_per_100g === undefined) throw V.badRequest('proposed.calories_per_100g is required for a new food');
  } else if (!Object.keys(out).length) {
    throw V.badRequest('A correction needs at least one proposed value');
  }
  return out;
}

/** Expire stale pending submissions, and make sure no resolved one keeps photos. */
async function cleanupQueue(db) {
  const expired = await db.query(
    `UPDATE food_label_submissions SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND created_at < NOW() - ($1 || ' days')::interval RETURNING id`,
    [String(STALE_DAYS)]
  );
  const del = await db.query(
    `DELETE FROM food_label_photos p USING food_label_submissions s WHERE s.id = p.submission_id AND s.status <> 'pending' RETURNING p.id`
  );
  return { expired: expired.rows.length, photos_deleted: del.rows.length };
}

const SUB_SELECT = `
  SELECT s.*, f.name AS food_name,
         COALESCE((SELECT json_agg(json_build_object('id', p.id, 'content_type', p.content_type, 'byte_size', p.byte_size, 'created_at', p.created_at) ORDER BY p.id)
                   FROM food_label_photos p WHERE p.submission_id = s.id), '[]') AS photos
  FROM food_label_submissions s LEFT JOIN foods f ON f.id = s.food_id`;

function submissionOut(row, { admin = false } = {}) {
  const out = {
    id: row.id, kind: row.kind, food_id: row.food_id, food_name: row.food_name, barcode: row.barcode,
    proposed: row.proposed, note: row.note, status: row.status, reject_reason: row.reject_reason,
    reviewed_at: row.reviewed_at, result_food_id: row.result_food_id, created_at: row.created_at, updated_at: row.updated_at,
    photos: row.status === 'pending' ? row.photos : [],
  };
  if (row.status === 'pending') out.expires_at = new Date(new Date(row.created_at).getTime() + STALE_DAYS * 864e5).toISOString();
  if (admin) { out.user_id = row.user_id; out.reviewed_by_user_id = row.reviewed_by_user_id; }
  return out;
}

/** A submission the caller may read: their own, or any for an admin. */
async function readableSubmission(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`${SUB_SELECT} WHERE s.id = $1`, [n]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.user_id === uid) return { row, admin: false };
  if (await isAdmin(db, uid)) return { row, admin: true };
  return null;
}

// POST /nutrition/label-submissions  { kind: new_food|correction, food_id? (correction), barcode?, proposed, note? }
const createSubmission = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const kind = V.take(V.oneOf(b.kind, 'kind', ['new_food', 'correction'], { required: true }));
    let foodId = null;
    if (kind === 'correction') {
      const food = await visibleFood(pool, V.take(V.intIn(b.food_id, 'food_id', 1, 2147483647, { required: true })), uid);
      if (!food) throw httpError(404, 'Food not found');
      foodId = food.id;
    } else if (b.food_id !== undefined && b.food_id !== null) {
      throw V.badRequest('food_id is only for a correction');
    }
    let barcode = V.take(V.text(b.barcode === undefined || b.barcode === null ? b.barcode : String(b.barcode), 'barcode', 20));
    if (barcode && !/^\d{6,20}$/.test(barcode)) throw V.badRequest('barcode must be 6 to 20 digits');
    const proposed = proposedArg(b.proposed, { kind });
    const note = V.take(V.text(b.note, 'note', 2000));
    const r = await pool.query(
      `INSERT INTO food_label_submissions (user_id, kind, food_id, barcode, proposed, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [uid, kind, foodId, barcode, JSON.stringify(proposed), note]
    );
    const row = (await pool.query(`${SUB_SELECT} WHERE s.id = $1`, [r.rows[0].id])).rows[0];
    res.status(201).json({ submission: submissionOut(row), max_photos: MAX_PHOTOS, max_photo_bytes: MAX_PHOTO_BYTES });
  } catch (err) { fail(res, err, 'create submission'); }
};

// GET /nutrition/label-submissions — the caller's own (runs the cleanup first)
const listMySubmissions = async (req, res) => {
  try {
    await cleanupQueue(pool);
    const r = await pool.query(`${SUB_SELECT} WHERE s.user_id = $1 ORDER BY s.created_at DESC, s.id DESC`, [req.user.userId]);
    res.json({ submissions: r.rows.map(row => submissionOut(row)) });
  } catch (err) { fail(res, err, 'list submissions'); }
};

// GET /nutrition/label-submissions/:id — own, or any for an admin
const getSubmission = async (req, res) => {
  try {
    await cleanupQueue(pool);
    const found = await readableSubmission(pool, req.params.id, req.user.userId);
    if (!found) throw httpError(404, 'Submission not found');
    res.json({ submission: submissionOut(found.row, { admin: found.admin }) });
  } catch (err) { fail(res, err, 'get submission'); }
};

/** The real type of an image from its first bytes (JPEG, PNG, WebP), else null. */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// POST /nutrition/label-submissions/:id/photos (multipart/form-data, field "photos", 1-3 files)
// Runs after multer (memory storage, 2 MB per file); the submitter only, while pending.
const addPhotos = async (req, res) => {
  const uid = req.user.userId;
  try {
    const files = req.files || [];
    if (!files.length) throw V.badRequest('Send 1 to 3 images in the "photos" field (multipart/form-data)');
    const checked = files.map((f, i) => {
      const type = sniffImage(f.buffer);
      if (!type) throw V.badRequest(`photos[${i}] is not a JPEG, PNG or WebP image`);
      if (f.mimetype && f.mimetype !== type && !(f.mimetype === 'image/jpg' && type === 'image/jpeg')) {
        throw V.badRequest(`photos[${i}] says ${f.mimetype} but is ${type}`);
      }
      if (f.size > MAX_PHOTO_BYTES) throw V.badRequest(`photos[${i}] is larger than 2 MB`);
      return { type, buffer: f.buffer, size: f.size };
    });
    const out = await tx(async db => {
      const s = await db.query(`SELECT * FROM food_label_submissions WHERE id = $1 AND user_id = $2 FOR UPDATE`, [idOf(req.params.id), uid]);
      if (!s.rows[0]) throw httpError(404, 'Submission not found');
      if (s.rows[0].status !== 'pending') throw httpError(409, `This submission is ${s.rows[0].status}; photos can only be added while it is pending`);
      const have = Number((await db.query(`SELECT COUNT(*) FROM food_label_photos WHERE submission_id = $1`, [s.rows[0].id])).rows[0].count);
      if (have + checked.length > MAX_PHOTOS) throw V.badRequest(`A submission can have at most ${MAX_PHOTOS} photos (it has ${have})`);
      for (const c of checked) {
        await db.query(`INSERT INTO food_label_photos (submission_id, content_type, byte_size, data) VALUES ($1,$2,$3,$4)`, [s.rows[0].id, c.type, c.size, c.buffer]);
      }
      await db.query(`UPDATE food_label_submissions SET updated_at = NOW() WHERE id = $1`, [s.rows[0].id]);
      return (await db.query(`${SUB_SELECT} WHERE s.id = $1`, [s.rows[0].id])).rows[0];
    });
    res.status(201).json({ submission: submissionOut(out) });
  } catch (err) { fail(res, err, 'add photos'); }
};

/** multer errors (too large, too many files) as clear 400s. */
function photoUploadErrors(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each photo must be at most 2 MB' });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: `Send at most ${MAX_PHOTOS} images, in the "photos" field` });
  }
  if (err.code && String(err.code).startsWith('LIMIT_')) return res.status(400).json({ error: 'Upload refused: ' + err.message });
  return next(err);
}

// GET /nutrition/label-submissions/:id/photos/:photoId — the image; submitter or admin, pending only
const getPhoto = async (req, res) => {
  try {
    await cleanupQueue(pool);
    const found = await readableSubmission(pool, req.params.id, req.user.userId);
    if (!found || found.row.status !== 'pending') throw httpError(404, 'Photo not found');
    const p = await pool.query(`SELECT content_type, data FROM food_label_photos WHERE id = $1 AND submission_id = $2`, [idOf(req.params.photoId), found.row.id]);
    if (!p.rows[0]) throw httpError(404, 'Photo not found');
    res.set('Content-Type', p.rows[0].content_type);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(p.rows[0].data);
  } catch (err) { fail(res, err, 'get photo'); }
};

// DELETE /nutrition/label-submissions/:id/photos/:photoId — the submitter, while pending
const deletePhoto = async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM food_label_photos p USING food_label_submissions s
       WHERE p.id = $1 AND p.submission_id = s.id AND s.id = $2 AND s.user_id = $3 AND s.status = 'pending' RETURNING p.id`,
      [idOf(req.params.photoId), idOf(req.params.id), req.user.userId]
    );
    if (!r.rows.length) throw httpError(404, 'Photo not found');
    res.json({ message: 'Photo deleted', id: r.rows[0].id });
  } catch (err) { fail(res, err, 'delete photo'); }
};

// ── Admin ────────────────────────────────────────────────────────────────────

async function requireAdmin(req) {
  if (!(await isAdmin(pool, req.user.userId))) throw httpError(403, 'Admin access required');
}

// GET /admin/label-submissions?status=pending|approved|rejected|expired|all (default pending)
const adminListSubmissions = async (req, res) => {
  try {
    await requireAdmin(req);
    const status = V.take(V.oneOf(req.query.status ?? 'pending', 'status', ['pending', 'approved', 'rejected', 'expired', 'all'], { required: true }));
    const cleanup = await cleanupQueue(pool);
    const r = await pool.query(
      `${SUB_SELECT} WHERE ($1 = 'all' OR s.status = $1) ORDER BY s.created_at ASC, s.id ASC`, [status]
    );
    res.json({ status, cleanup, submissions: r.rows.map(row => submissionOut(row, { admin: true })) });
  } catch (err) { fail(res, err, 'list label queue'); }
};

// GET /admin/label-submissions/:id
const adminGetSubmission = async (req, res) => {
  try {
    await requireAdmin(req);
    await cleanupQueue(pool);
    const r = await pool.query(`${SUB_SELECT} WHERE s.id = $1`, [idOf(req.params.id)]);
    if (!r.rows[0]) throw httpError(404, 'Submission not found');
    res.json({ submission: submissionOut(r.rows[0], { admin: true }) });
  } catch (err) { fail(res, err, 'get submission'); }
};

const FOOD_COLUMNS = Object.keys(PROPOSED_FIELDS);

// POST /admin/label-submissions/:id/approve  { values? } — values (same keys as
// proposed) replace the proposed ones. new_food creates a public food;
// correction updates the food. Photos are deleted in the same transaction.
const adminApprove = async (req, res) => {
  try {
    await requireAdmin(req);
    const b = req.body || {};
    const out = await tx(async db => {
      const s = (await db.query(`SELECT * FROM food_label_submissions WHERE id = $1 FOR UPDATE`, [idOf(req.params.id)])).rows[0];
      if (!s) throw httpError(404, 'Submission not found');
      if (s.status !== 'pending') throw httpError(409, `This submission is already ${s.status}`);
      const vals = { ...s.proposed, ...(b.values ? proposedArg(b.values, { kind: 'correction' }) : {}) };
      let foodId;
      if (s.kind === 'new_food') {
        proposedArg(vals, { kind: 'new_food' });
        const cols = FOOD_COLUMNS.filter(c => vals[c] !== undefined);
        const params = cols.map(c => vals[c]);
        for (const c of ['protein_per_100g', 'carbs_per_100g', 'fat_per_100g']) if (!cols.includes(c)) { cols.push(c); params.push(0); }
        cols.push('gtin_upc'); params.push(s.barcode);
        // Public food: no creator recorded, so the submitter is not exposed in food reads.
        const r = await db.query(
          `INSERT INTO foods (${cols.join(', ')}, source, is_custom, is_verified)
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, 'label_submission', FALSE, TRUE) RETURNING id`,
          params
        );
        foodId = r.rows[0].id;
      } else {
        if (!s.food_id) throw httpError(409, 'The food this correction was for no longer exists; reject it instead');
        const cols = FOOD_COLUMNS.filter(c => vals[c] !== undefined);
        const params = cols.map(c => vals[c]);
        if (s.barcode) { cols.push('gtin_upc'); params.push(s.barcode); }
        await db.query(
          `UPDATE foods SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [s.food_id, ...params]
        );
        foodId = s.food_id;
      }
      await db.query(`DELETE FROM food_label_photos WHERE submission_id = $1`, [s.id]);
      await db.query(
        `UPDATE food_label_submissions SET status = 'approved', reviewed_by_user_id = $2, reviewed_at = NOW(), result_food_id = $3,
           proposed = $4, updated_at = NOW() WHERE id = $1`,
        [s.id, req.user.userId, foodId, JSON.stringify(vals)]
      );
      return { submission: (await db.query(`${SUB_SELECT} WHERE s.id = $1`, [s.id])).rows[0], food: (await db.query(`SELECT * FROM foods WHERE id = $1`, [foodId])).rows[0] };
    });
    res.json({ submission: submissionOut(out.submission, { admin: true }), food: out.food });
  } catch (err) { fail(res, err, 'approve submission'); }
};

// POST /admin/label-submissions/:id/reject  { reason } — photos deleted at once
const adminReject = async (req, res) => {
  try {
    await requireAdmin(req);
    const reason = V.take(V.text(req.body?.reason, 'reason', 1000, { required: true }));
    const out = await tx(async db => {
      const s = (await db.query(`SELECT * FROM food_label_submissions WHERE id = $1 FOR UPDATE`, [idOf(req.params.id)])).rows[0];
      if (!s) throw httpError(404, 'Submission not found');
      if (s.status !== 'pending') throw httpError(409, `This submission is already ${s.status}`);
      await db.query(`DELETE FROM food_label_photos WHERE submission_id = $1`, [s.id]);
      await db.query(
        `UPDATE food_label_submissions SET status = 'rejected', reject_reason = $2, reviewed_by_user_id = $3, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [s.id, reason, req.user.userId]
      );
      return (await db.query(`${SUB_SELECT} WHERE s.id = $1`, [s.id])).rows[0];
    });
    res.json({ submission: submissionOut(out, { admin: true }) });
  } catch (err) { fail(res, err, 'reject submission'); }
};

module.exports = {
  listOverrides, getOverride, putOverride, deleteOverride, getFoodForMe, scanBarcodeForMe,
  createCraving, listCravings, getCraving, updateCraving, deleteCraving, cravingSummary,
  createSubmission, listMySubmissions, getSubmission, addPhotos, photoUploadErrors, getPhoto, deletePhoto,
  adminListSubmissions, adminGetSubmission, adminApprove, adminReject, cleanupQueue,
  MAX_PHOTOS, MAX_PHOTO_BYTES,
};
