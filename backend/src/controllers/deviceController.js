// backend/src/controllers/deviceController.js
// Device-ready storage and saved routes (Phase 1A-2). Storage only: nothing
// imports from a device or file yet (Phase 3-6).
//
// Owners: 'cardio-session' (cardio_sessions, the older Quick Cardio flow) and
// 'segment' (workout_cardio_segments). Samples go to cardio_samples.
const { pool } = require('../config/database');
const V = require('../utils/validate');

const OWNERS = {
  'cardio-session': { table: 'cardio_sessions', sampleType: 'cardio_session', calories: 'calories_burned' },
  segment: { table: 'workout_cardio_segments', sampleType: 'segment', calories: 'calories_burned' },
};
const HR = v => V.intIn(v, 'heart rate', 20, 260);
const SECS = f => v => V.intIn(v, f, 0, 86400 * 2);
// Fields accepted on both owners (cardio_sessions already had several of them).
const FIELDS = {
  avg_heart_rate: HR, max_heart_rate: HR, min_heart_rate: HR,
  hr_zone_1_seconds: SECS('hr_zone_1_seconds'), hr_zone_2_seconds: SECS('hr_zone_2_seconds'),
  hr_zone_3_seconds: SECS('hr_zone_3_seconds'), hr_zone_4_seconds: SECS('hr_zone_4_seconds'),
  hr_zone_5_seconds: SECS('hr_zone_5_seconds'),
  elevation_gain: v => V.numMin(v, 'elevation_gain', 0, { max: 99999 }),
  elevation_loss: v => V.numMin(v, 'elevation_loss', 0, { max: 99999 }),
  elevation_max: v => V.numMin(v, 'elevation_max', -500, { max: 99999 }),
  avg_cadence: v => V.intIn(v, 'avg_cadence', 0, 400), max_cadence: v => V.intIn(v, 'max_cadence', 0, 400),
  calories_burned: v => V.intIn(v, 'calories_burned', 0, 100000),
  source_device: v => V.text(v, 'source_device', 100),
  external_id: v => V.text(v, 'external_id', 200),
  route_data: v => (v === null || v === undefined ? { value: null }
    : typeof v === 'object' ? { value: v } : { error: 'route_data must be an object or a list (e.g. GeoJSON or [[lat, lon], ...])' }),
  saved_route_id: v => V.intIn(v, 'saved_route_id', 1, 2147483647),
};
const OUT_COLS = ['id', ...Object.keys(FIELDS)];
const SAMPLE_FIELDS = {
  offset_seconds: v => V.numMin(v, 'offset_seconds', 0, { required: true, max: 86400 * 7 }),
  heart_rate: HR, elevation: v => V.numMin(v, 'elevation', -500, { max: 99999 }),
  latitude: v => V.numMin(v, 'latitude', -90, { max: 90 }), longitude: v => V.numMin(v, 'longitude', -180, { max: 180 }),
  cadence: v => V.intIn(v, 'cadence', 0, 400), speed: v => V.numMin(v, 'speed', 0, { max: 1000 }),
  distance: v => V.numMin(v, 'distance', 0, { max: 9999999 }), power: v => V.intIn(v, 'power', 0, 5000),
};

function fail(res, err, what) {
  if ([400, 404].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const notFound = what => Object.assign(new Error(`${what} not found`), { statusCode: 404 });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

/** The owner row id if it is the user's (and not soft-deleted), else null. */
async function ownOwner(db, type, id, uid) {
  const n = idOf(id);
  if (!OWNERS[type] || !n) return null;
  const r = type === 'segment'
    ? await db.query(
      `SELECT s.id FROM workout_cardio_segments s JOIN workouts w ON w.id = s.workout_id
       WHERE s.id = $1 AND w.user_id = $2 AND s.deleted_at IS NULL AND w.deleted_at IS NULL`, [n, uid])
    : await db.query(`SELECT id FROM cardio_sessions WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0]?.id || null;
}
async function readDevice(db, type, id) {
  const r = await db.query(`SELECT ${OUT_COLS.join(', ')} FROM ${OWNERS[type].table} WHERE id = $1`, [id]);
  return { owner_type: type, ...r.rows[0] };
}

// GET /device/:type/:id
const getDevice = async (req, res) => {
  try {
    const id = await ownOwner(pool, req.params.type, req.params.id, req.user.userId);
    if (!id) throw notFound('Record');
    res.json(await readDevice(pool, req.params.type, id));
  } catch (err) { fail(res, err, 'get device data'); }
};

// PUT /device/:type/:id  { any device field } — only keys sent change
const putDevice = async (req, res) => {
  const uid = req.user.userId;
  try {
    const body = req.body || {};
    const f = {};
    for (const [k, check] of Object.entries(FIELDS)) if (k in body) f[k] = V.take(check(body[k]));
    const unknown = Object.keys(body).filter(k => !(k in FIELDS));
    if (unknown.length) throw V.badRequest(`Unknown field(s): ${unknown.join(', ')}`);
    if (!Object.keys(f).length) throw V.badRequest(`Send at least one of: ${Object.keys(FIELDS).join(', ')}`);
    const id = await ownOwner(pool, req.params.type, req.params.id, uid);
    if (!id) throw notFound('Record');
    if (f.saved_route_id) {
      const r = await pool.query(`SELECT 1 FROM saved_routes WHERE id = $1 AND user_id = $2`, [f.saved_route_id, uid]);
      if (!r.rows.length) throw V.badRequest('saved_route_id is not one of your saved routes');
    }
    const keys = Object.keys(f);
    await pool.query(
      `UPDATE ${OWNERS[req.params.type].table} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
      [...keys.map(k => (k === 'route_data' && f[k] !== null ? JSON.stringify(f[k]) : f[k])), id]
    );
    res.json(await readDevice(pool, req.params.type, id));
  } catch (err) { fail(res, err, 'save device data'); }
};

// GET /device/:type/:id/samples
const getSamples = async (req, res) => {
  try {
    const id = await ownOwner(pool, req.params.type, req.params.id, req.user.userId);
    if (!id) throw notFound('Record');
    const r = await pool.query(
      `SELECT offset_seconds::float AS offset_seconds, heart_rate, elevation::float AS elevation, latitude::float AS latitude,
              longitude::float AS longitude, cadence, speed::float AS speed, distance::float AS distance, power
       FROM cardio_samples WHERE owner_type = $1 AND owner_id = $2 ORDER BY offset_seconds, id`,
      [OWNERS[req.params.type].sampleType, id]
    );
    res.json({ owner_type: req.params.type, owner_id: id, samples: r.rows });
  } catch (err) { fail(res, err, 'get samples'); }
};

// POST /device/:type/:id/samples  { samples: [...], replace?: true } (up to 20000 per call)
const postSamples = async (req, res) => {
  const uid = req.user.userId;
  const client = await pool.connect();
  try {
    const list = req.body?.samples;
    if (!Array.isArray(list) || !list.length) throw V.badRequest('samples must be a non-empty list');
    if (list.length > 20000) throw V.badRequest('At most 20000 samples per request');
    const rows = list.map((s, i) => {
      if (!s || typeof s !== 'object') throw V.badRequest(`samples[${i}] must be an object`);
      const o = {};
      for (const [k, check] of Object.entries(SAMPLE_FIELDS)) {
        const r = check(s[k]);
        if (r.error) throw V.badRequest(`samples[${i}]: ${r.error}`);
        o[k] = r.value;
      }
      return o;
    });
    const replace = V.take(V.bool(req.body.replace, 'replace'));
    await client.query('BEGIN');
    const id = await ownOwner(client, req.params.type, req.params.id, uid);
    if (!id) throw notFound('Record');
    const type = OWNERS[req.params.type].sampleType;
    if (replace) await client.query(`DELETE FROM cardio_samples WHERE owner_type = $1 AND owner_id = $2`, [type, id]);
    const cols = Object.keys(SAMPLE_FIELDS);
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const vals = []; const tuples = [];
      for (const r of chunk) {
        const base = vals.length;
        vals.push(uid, type, id, ...cols.map(c => r[c]));
        tuples.push(`(${Array.from({ length: cols.length + 3 }, (_, j) => `$${base + j + 1}`).join(', ')})`);
      }
      await client.query(`INSERT INTO cardio_samples (user_id, owner_type, owner_id, ${cols.join(', ')}) VALUES ${tuples.join(', ')}`, vals);
    }
    await client.query('COMMIT');
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM cardio_samples WHERE owner_type = $1 AND owner_id = $2`, [type, id]);
    res.status(201).json({ added: rows.length, total: count.rows[0].n });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'save samples');
  } finally { client.release(); }
};

// ── Saved routes ──────────────────────────────────────────────────────────────

const ROUTE_COLS = `id, name, route_data, distance::float AS distance, distance_unit, notes, created_at, updated_at`;
function routeFields(body, { creating }) {
  const out = {};
  if (creating || 'name' in body) out.name = V.take(V.text(body.name, 'name', 100, { required: true }));
  if ('route_data' in body) out.route_data = V.take(FIELDS.route_data(body.route_data));
  if ('distance' in body) out.distance = V.take(V.numMin(body.distance, 'distance', 0, { max: 9999999 }));
  if ('distance_unit' in body) out.distance_unit = V.take(V.text(body.distance_unit, 'distance_unit', 20));
  if ('notes' in body) out.notes = V.take(V.text(body.notes, 'notes', 5000));
  return out;
}
const enc = (k, v) => (k === 'route_data' && v !== null ? JSON.stringify(v) : v);
async function ownRoute(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT ${ROUTE_COLS} FROM saved_routes WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0] || null;
}

// GET /saved-routes
const listRoutes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${ROUTE_COLS} FROM saved_routes WHERE user_id = $1 ORDER BY lower(name), id`, [req.user.userId]);
    res.json({ routes: r.rows });
  } catch (err) { fail(res, err, 'list routes'); }
};
// GET /saved-routes/:id
const getRoute = async (req, res) => {
  try {
    const route = await ownRoute(pool, req.params.id, req.user.userId);
    if (!route) throw notFound('Route');
    res.json({ route });
  } catch (err) { fail(res, err, 'get route'); }
};
// POST /saved-routes  { name, route_data?, distance?, distance_unit?, notes? }
const createRoute = async (req, res) => {
  try {
    const f = routeFields(req.body || {}, { creating: true });
    const keys = Object.keys(f);
    const r = await pool.query(
      `INSERT INTO saved_routes (user_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
      [req.user.userId, ...keys.map(k => enc(k, f[k]))]
    );
    res.status(201).json({ route: await ownRoute(pool, r.rows[0].id, req.user.userId) });
  } catch (err) { fail(res, err, 'create route'); }
};
// PUT /saved-routes/:id
const updateRoute = async (req, res) => {
  try {
    const route = await ownRoute(pool, req.params.id, req.user.userId);
    if (!route) throw notFound('Route');
    const f = routeFields(req.body || {}, { creating: false });
    const keys = Object.keys(f);
    if (keys.length) {
      await pool.query(
        `UPDATE saved_routes SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1}`,
        [...keys.map(k => enc(k, f[k])), route.id]
      );
    }
    res.json({ route: await ownRoute(pool, route.id, req.user.userId) });
  } catch (err) { fail(res, err, 'update route'); }
};
// DELETE /saved-routes/:id (sessions and segments that used it keep their own route_data)
const deleteRoute = async (req, res) => {
  try {
    const route = await ownRoute(pool, req.params.id, req.user.userId);
    if (!route) throw notFound('Route');
    await pool.query(`DELETE FROM saved_routes WHERE id = $1`, [route.id]);
    res.json({ message: 'Route deleted' });
  } catch (err) { fail(res, err, 'delete route'); }
};
// POST /saved-routes/:id/apply  { owner_type: segment | cardio-session, owner_id }
// Reuse: links the route and copies its route_data (and distance when the target has none).
const applyRoute = async (req, res) => {
  const uid = req.user.userId;
  try {
    const type = V.take(V.oneOf(req.body?.owner_type, 'owner_type', Object.keys(OWNERS), { required: true }));
    const route = await ownRoute(pool, req.params.id, uid);
    if (!route) throw notFound('Route');
    const id = await ownOwner(pool, type, req.body?.owner_id, uid);
    if (!id) throw notFound('Record');
    await pool.query(
      `UPDATE ${OWNERS[type].table} SET saved_route_id = $1, route_data = $2::jsonb, distance = COALESCE(distance, $3) WHERE id = $4`,
      [route.id, route.route_data === null ? null : JSON.stringify(route.route_data), route.distance, id]
    );
    const r = await pool.query(`SELECT distance::float AS distance FROM ${OWNERS[type].table} WHERE id = $1`, [id]);
    res.json({ ...(await readDevice(pool, type, id)), distance: r.rows[0].distance });
  } catch (err) { fail(res, err, 'apply route'); }
};

module.exports = {
  getDevice, putDevice, getSamples, postSamples, listRoutes, getRoute, createRoute, updateRoute, deleteRoute, applyRoute,
};
