// backend/src/controllers/checkinController.js
// Check-ins (Phase 1A-2).
//
// Readiness (per workout): optional sleep / soreness / energy, 1-5 each, saved
// on the workout. Whether to ask is resolved routine → program → user setting
// (NULL on the routine or program means "follow the next one"); default off.
//
// Daily check-in: preset items (sleep, soreness, energy, mood) created for
// each user on first read, plus the user's own items. Ratings 1-5 by default.
// An item can link to a habit (habit_id) for later habit/goal tracking.
const { pool } = require('../config/database');
const V = require('../utils/validate');

const PRESETS = [
  { key: 'sleep', label: 'Sleep', order: 1 },
  { key: 'soreness', label: 'Soreness', order: 2 },
  { key: 'energy', label: 'Energy', order: 3 },
  { key: 'mood', label: 'Mood', order: 4 },
];

function fail(res, err, what) {
  if (err.statusCode === 400) return res.status(400).json({ error: err.message });
  if (err.statusCode === 404) return res.status(404).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const notFound = what => Object.assign(new Error(`${what} not found`), { statusCode: 404 });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

// ── Readiness ─────────────────────────────────────────────────────────────────

/** { enabled, source } for a routine / program pair (either may be null). */
async function resolveReadiness(db, uid, routineId, programId) {
  if (routineId) {
    const r = await db.query(`SELECT readiness_checkin FROM workout_routines WHERE id = $1 AND user_id = $2`, [routineId, uid]);
    if (r.rows[0] && r.rows[0].readiness_checkin !== null) return { enabled: r.rows[0].readiness_checkin, source: 'routine' };
  }
  if (programId) {
    const p = await db.query(`SELECT readiness_checkin FROM programs WHERE id = $1 AND user_id = $2`, [programId, uid]);
    if (p.rows[0] && p.rows[0].readiness_checkin !== null) return { enabled: p.rows[0].readiness_checkin, source: 'program' };
  }
  const u = await db.query(`SELECT readiness_checkin_default FROM users WHERE id = $1`, [uid]);
  return { enabled: !!u.rows[0]?.readiness_checkin_default, source: 'user' };
}

// GET /checkins/readiness/setting?routine_id=&program_id=
const getReadinessSetting = async (req, res) => {
  try {
    const routineId = V.take(V.intIn(req.query.routine_id, 'routine_id', 1, 2147483647));
    const programId = V.take(V.intIn(req.query.program_id, 'program_id', 1, 2147483647));
    const u = await pool.query(`SELECT readiness_checkin_default FROM users WHERE id = $1`, [req.user.userId]);
    res.json({
      user_default: !!u.rows[0]?.readiness_checkin_default,
      ...(await resolveReadiness(pool, req.user.userId, routineId, programId)),
    });
  } catch (err) { fail(res, err, 'get readiness setting'); }
};

// PUT /checkins/readiness/default  { enabled: true|false }
const setReadinessDefault = async (req, res) => {
  try {
    const enabled = V.take(V.bool(req.body?.enabled, 'enabled'));
    if (enabled === null) throw V.badRequest('enabled must be true or false');
    await pool.query(`UPDATE users SET readiness_checkin_default = $1 WHERE id = $2`, [enabled, req.user.userId]);
    res.json({ user_default: enabled });
  } catch (err) { fail(res, err, 'save readiness setting'); }
};

// PUT /checkins/readiness/program/:id | /routine/:id  { enabled: true|false|null } (null = follow the next level)
const setReadinessOverride = table => async (req, res) => {
  try {
    if (!('enabled' in (req.body || {}))) throw V.badRequest('enabled is required (true, false or null)');
    const enabled = V.take(V.bool(req.body.enabled, 'enabled'));
    const id = idOf(req.params.id);
    const r = id && await pool.query(
      `UPDATE ${table} SET readiness_checkin = $1 WHERE id = $2 AND user_id = $3 RETURNING id, readiness_checkin`,
      [enabled, id, req.user.userId]
    );
    if (!r || !r.rows.length) throw notFound(table === 'programs' ? 'Program' : 'Routine');
    res.json(r.rows[0]);
  } catch (err) { fail(res, err, 'save readiness setting'); }
};

async function ownWorkout(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(
    `SELECT id, routine_id, program_id, readiness_sleep, readiness_soreness, readiness_energy, readiness_recorded_at
     FROM workouts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [n, uid]
  );
  return r.rows[0] || null;
}
const readinessOut = w => ({
  workout_id: w.id,
  sleep: w.readiness_sleep, soreness: w.readiness_soreness, energy: w.readiness_energy,
  recorded_at: w.readiness_recorded_at,
});

// GET /workouts/:workoutId/readiness — values plus whether to ask for this workout
const getWorkoutReadiness = async (req, res) => {
  try {
    const w = await ownWorkout(pool, req.params.workoutId, req.user.userId);
    if (!w) throw notFound('Workout');
    res.json({ readiness: readinessOut(w), setting: await resolveReadiness(pool, req.user.userId, w.routine_id, w.program_id) });
  } catch (err) { fail(res, err, 'get readiness'); }
};

// PUT /workouts/:workoutId/readiness  { sleep?, soreness?, energy? } (1-5, null clears)
const putWorkoutReadiness = async (req, res) => {
  try {
    const body = req.body || {};
    const keys = ['sleep', 'soreness', 'energy'].filter(k => k in body);
    if (!keys.length) throw V.badRequest('Send at least one of: sleep, soreness, energy');
    const vals = keys.map(k => V.take(V.intIn(body[k], k, 1, 5)));
    const w = await ownWorkout(pool, req.params.workoutId, req.user.userId);
    if (!w) throw notFound('Workout');
    const r = await pool.query(
      `UPDATE workouts SET ${keys.map((k, i) => `readiness_${k} = $${i + 1}`).join(', ')}, readiness_recorded_at = NOW()
       WHERE id = $${keys.length + 1}
       RETURNING id, readiness_sleep, readiness_soreness, readiness_energy, readiness_recorded_at`,
      [...vals, w.id]
    );
    res.json({ readiness: readinessOut(r.rows[0]) });
  } catch (err) { fail(res, err, 'save readiness'); }
};

// ── Daily check-in ────────────────────────────────────────────────────────────

async function ensurePresets(db, uid) {
  for (const p of PRESETS) {
    await db.query(
      `INSERT INTO checkin_items (user_id, preset_key, label, order_index) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, preset_key) WHERE preset_key IS NOT NULL DO NOTHING`,
      [uid, p.key, p.label, p.order]
    );
  }
}

async function ownItem(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT * FROM checkin_items WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0] || null;
}

async function checkHabit(db, habitId, uid) {
  if (!habitId) return;
  const r = await db.query(`SELECT 1 FROM habits WHERE id = $1 AND user_id = $2`, [habitId, uid]);
  if (!r.rows.length) throw V.badRequest('habit_id is not one of your habits');
}

// GET /checkins/items?include_inactive=true
const listItems = async (req, res) => {
  try {
    await ensurePresets(pool, req.user.userId);
    const all = req.query.include_inactive === 'true';
    const r = await pool.query(
      `SELECT * FROM checkin_items WHERE user_id = $1 ${all ? '' : 'AND is_active'} ORDER BY order_index, id`, [req.user.userId]
    );
    res.json({ items: r.rows });
  } catch (err) { fail(res, err, 'list check-in items'); }
};

// POST /checkins/items  { label, scale_min? (default 1), scale_max? (default 5), habit_id? }
const createItem = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const label = V.take(V.text(b.label, 'label', 50, { required: true }));
    const min = V.take(V.intIn(b.scale_min, 'scale_min', 0, 100)) ?? 1;
    const max = V.take(V.intIn(b.scale_max, 'scale_max', 1, 100)) ?? 5;
    if (max <= min) throw V.badRequest('scale_max must be more than scale_min');
    const habitId = V.take(V.intIn(b.habit_id, 'habit_id', 1, 2147483647));
    await checkHabit(pool, habitId, uid);
    const next = await pool.query(`SELECT COALESCE(MAX(order_index), 0) + 1 AS n FROM checkin_items WHERE user_id = $1`, [uid]);
    const r = await pool.query(
      `INSERT INTO checkin_items (user_id, label, scale_min, scale_max, habit_id, order_index) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uid, label, min, max, habitId, next.rows[0].n]
    );
    res.status(201).json({ item: r.rows[0] });
  } catch (err) { fail(res, err, 'create check-in item'); }
};

// PUT /checkins/items/:id  { label?, habit_id?, is_active?, order_index? }
const updateItem = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const item = await ownItem(pool, req.params.id, uid);
    if (!item) throw notFound('Check-in item');
    const f = {};
    if ('label' in b) f.label = V.take(V.text(b.label, 'label', 50, { required: true }));
    if ('habit_id' in b) { f.habit_id = V.take(V.intIn(b.habit_id, 'habit_id', 1, 2147483647)); await checkHabit(pool, f.habit_id, uid); }
    if ('is_active' in b) { const a = V.take(V.bool(b.is_active, 'is_active')); if (a !== null) f.is_active = a; }
    if ('order_index' in b) f.order_index = V.take(V.intIn(b.order_index, 'order_index', 0, 10000, { required: true }));
    const keys = Object.keys(f);
    if (!keys.length) return res.json({ item });
    const r = await pool.query(
      `UPDATE checkin_items SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
      [...Object.values(f), item.id]
    );
    res.json({ item: r.rows[0] });
  } catch (err) { fail(res, err, 'update check-in item'); }
};

// DELETE /checkins/items/:id — user-defined items only (turn presets off with is_active: false)
const deleteItem = async (req, res) => {
  try {
    const item = await ownItem(pool, req.params.id, req.user.userId);
    if (!item) throw notFound('Check-in item');
    if (item.preset_key) throw V.badRequest('A preset item cannot be deleted; set is_active to false to hide it');
    await pool.query(`DELETE FROM checkin_items WHERE id = $1`, [item.id]);
    res.json({ message: 'Check-in item deleted' });
  } catch (err) { fail(res, err, 'delete check-in item'); }
};

async function dayOut(db, uid, date) {
  const r = await db.query(
    `SELECT ci.id AS item_id, ci.label, ci.preset_key, ci.scale_min, ci.scale_max, ci.habit_id, ce.value
     FROM checkin_items ci
     LEFT JOIN checkin_entries ce ON ce.item_id = ci.id AND ce.entry_date = $2
     WHERE ci.user_id = $1 AND (ci.is_active OR ce.id IS NOT NULL)
     ORDER BY ci.order_index, ci.id`,
    [uid, date]
  );
  return { date, items: r.rows };
}

// GET /checkins/daily/:date
const getDay = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    await ensurePresets(pool, req.user.userId);
    res.json(await dayOut(pool, req.user.userId, date));
  } catch (err) { fail(res, err, 'get daily check-in'); }
};

// PUT /checkins/daily/:date  { values: [{ item_id, value }] } (value null removes that answer)
const putDay = async (req, res) => {
  const uid = req.user.userId;
  const client = await pool.connect();
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const values = req.body?.values;
    if (!Array.isArray(values) || !values.length) throw V.badRequest('values must be a non-empty list of { item_id, value }');
    await client.query('BEGIN');
    for (const [i, v] of values.entries()) {
      const item = await ownItem(client, v?.item_id, uid);
      if (!item) throw V.badRequest(`values[${i}].item_id is not one of your check-in items`);
      const val = V.take(V.intIn(v.value, `values[${i}].value`, item.scale_min, item.scale_max));
      if (val === null) {
        await client.query(`DELETE FROM checkin_entries WHERE item_id = $1 AND entry_date = $2`, [item.id, date]);
      } else {
        await client.query(
          `INSERT INTO checkin_entries (user_id, item_id, entry_date, value) VALUES ($1,$2,$3,$4)
           ON CONFLICT (item_id, entry_date) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [uid, item.id, date, val]
        );
      }
    }
    await client.query('COMMIT');
    res.json(await dayOut(pool, uid, date));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'save daily check-in');
  } finally { client.release(); }
};

// GET /checkins/daily?from=&to= — every answer in a range
const listDays = async (req, res) => {
  try {
    const from = V.take(V.dateStr(req.query.from, 'from', { required: true }));
    const to = V.take(V.dateStr(req.query.to, 'to', { required: true }));
    const r = await pool.query(
      `SELECT to_char(ce.entry_date, 'YYYY-MM-DD') AS date, ce.item_id, ci.label, ci.preset_key, ce.value
       FROM checkin_entries ce JOIN checkin_items ci ON ci.id = ce.item_id
       WHERE ce.user_id = $1 AND ce.entry_date BETWEEN $2 AND $3
       ORDER BY ce.entry_date, ci.order_index, ci.id`,
      [req.user.userId, from, to]
    );
    res.json({ from, to, entries: r.rows });
  } catch (err) { fail(res, err, 'list daily check-ins'); }
};

module.exports = {
  resolveReadiness, getReadinessSetting, setReadinessDefault,
  setProgramReadiness: setReadinessOverride('programs'), setRoutineReadiness: setReadinessOverride('workout_routines'),
  getWorkoutReadiness, putWorkoutReadiness,
  listItems, createItem, updateItem, deleteItem, getDay, putDay, listDays,
};
