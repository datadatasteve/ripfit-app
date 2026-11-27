// backend/src/controllers/editController.js
// Edit audit trail and soft delete (Phase 1A-2).
//
// - Editing a finished (completed) workout, or a set or cardio segment of one,
//   writes the original values to record_edits and sets edited_at. Edits to an
//   in-progress workout's sets and segments are allowed and not logged (that is
//   still logging, not editing history).
// - Deleting a workout, set or segment is a soft delete: deleted_at and a
//   required deleted_reason. Every read path skips soft-deleted rows. Restore
//   undoes it. Both are logged in record_edits.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { retagSafely } = require('../utils/noteTags');

function fail(res, err, what) {
  if ([400, 404, 409].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

/** { column: { from, to } } for the keys whose value really changes. */
function changesOf(before, after) {
  const out = {};
  const norm = v => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
  for (const [k, v] of Object.entries(after)) {
    const a = norm(before[k]); const b = norm(v);
    const same = (a === null || b === null)
      ? a === b
      : (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && a !== '' && b !== '')
        ? Number(a) === Number(b)
        : String(a) === String(b);
    if (!same) out[k] = { from: a, to: b };
  }
  return out;
}

async function logEdit(db, { userId, type, id, workoutId, action, changes = null, reason = null }) {
  await db.query(
    `INSERT INTO record_edits (user_id, record_type, record_id, workout_id, action, changes, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, type, id, workoutId, action, changes ? JSON.stringify(changes) : null, reason]
  );
}

// ── Loaders (base tables: these endpoints must see soft-deleted rows) ─────────

async function loadWorkout(db, id, uid, { lock = false } = {}) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT * FROM workouts WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [n, uid]);
  return r.rows[0] || null;
}
async function loadSet(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(
    `SELECT ws.*, w.id AS w_id, w.status AS w_status, w.deleted_at AS w_deleted_at
     FROM workout_sets ws JOIN workout_exercises we ON we.id = ws.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id
     WHERE ws.id = $1 AND w.user_id = $2 FOR UPDATE OF ws`,
    [n, uid]
  );
  return r.rows[0] || null;
}
async function loadSegment(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(
    `SELECT s.*, w.id AS w_id, w.status AS w_status, w.deleted_at AS w_deleted_at
     FROM workout_cardio_segments s JOIN workouts w ON w.id = s.workout_id
     WHERE s.id = $1 AND w.user_id = $2 FOR UPDATE OF s`,
    [n, uid]
  );
  return r.rows[0] || null;
}
const strip = row => { const { w_id, w_status, w_deleted_at, ...rest } = row; return rest; };

/** Runs fn inside a transaction on a pooled client. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

// ── Edits ─────────────────────────────────────────────────────────────────────

const WORKOUT_EDIT = {
  workout_date: v => V.dateStr(v, 'workout_date', { required: true }),
  workout_title: v => V.text(v, 'workout_title', 200),
  overall_notes: v => V.text(v, 'overall_notes', 20000),
  session_notes: v => V.text(v, 'session_notes', 20000),
  session_rating: v => V.intIn(v, 'session_rating', 1, 10),
  vibes_rating: v => V.intIn(v, 'vibes_rating', 1, 10),
  fuel_rating: v => V.intIn(v, 'fuel_rating', 1, 5),
  duration_seconds: v => V.intIn(v, 'duration_seconds', 0, 86400 * 2),
};
const SET_EDIT = {
  reps_completed: v => V.intIn(v, 'reps_completed', 0, 100000, { required: true }),
  weight_used: v => V.numMin(v, 'weight_used', 0, { required: true, max: 9999 }),
  rpe: v => V.intIn(v, 'rpe', 1, 11),
  rest_seconds: v => V.intIn(v, 'rest_seconds', 0, 86400),
  set_type: v => V.oneOf(v, 'set_type', ['normal', 'warmup', 'drop', 'superset', 'emom', 'tabata', 'amrap', 'interval'], { required: true }),
};
const SEGMENT_EDIT = {
  segment_label: v => V.text(v, 'segment_label', 100),
  duration_seconds: v => V.intIn(v, 'duration_seconds', 0, 86400 * 2),
  distance: v => V.numMin(v, 'distance', 0, { max: 9999999 }),
  distance_unit: v => V.text(v, 'distance_unit', 20),
  pace: v => V.numMin(v, 'pace', 0, { max: 999999 }),
  pace_unit: v => V.text(v, 'pace_unit', 20),
  reps: v => V.intIn(v, 'reps', 0, 100000),
  avg_speed: v => V.numMin(v, 'avg_speed', 0, { max: 9999 }),
  max_speed: v => V.numMin(v, 'max_speed', 0, { max: 9999 }),
  notes: v => V.text(v, 'notes', 5000),
};

function pick(body, spec) {
  const out = {};
  for (const [k, check] of Object.entries(spec)) if (k in (body || {})) out[k] = V.take(check(body[k]));
  if (!Object.keys(out).length) throw V.badRequest(`Send at least one of: ${Object.keys(spec).join(', ')}`);
  return out;
}

// PATCH /workouts/:workoutId/edit — fields of a finished workout
const editWorkout = async (req, res) => {
  const uid = req.user.userId;
  try {
    const f = pick(req.body, WORKOUT_EDIT);
    const out = await tx(async db => {
      const w = await loadWorkout(db, req.params.workoutId, uid, { lock: true });
      if (!w || w.deleted_at) throw httpError(404, 'Workout not found');
      if (w.status !== 'completed') throw httpError(409, 'Only a finished workout is edited here; an open workout is still being logged');
      const before = { ...w, workout_date: w.workout_date ? require('../utils/programSchedule').dbDate(w.workout_date) : null };
      const changes = changesOf(before, f);
      if (!Object.keys(changes).length) return { workout: w, changes };
      const keys = Object.keys(changes);
      const r = await db.query(
        `UPDATE workouts SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, edited_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
        [...keys.map(k => f[k]), w.id]
      );
      await logEdit(db, { userId: uid, type: 'workout', id: w.id, workoutId: w.id, action: 'edit', changes });
      if ('overall_notes' in changes) await retagSafely(db, { userId: uid, workoutId: w.id, sourceType: 'workout_overall', sourceId: w.id, text: f.overall_notes });
      if ('session_notes' in changes) await retagSafely(db, { userId: uid, workoutId: w.id, sourceType: 'workout_session', sourceId: w.id, text: f.session_notes });
      return { workout: r.rows[0], changes };
    });
    res.json(out);
  } catch (err) { fail(res, err, 'edit workout'); }
};

/** Shared by set and segment edits. Logged only when the workout is finished. */
async function editChild(req, res, { type, spec, loader, table }) {
  const uid = req.user.userId;
  try {
    const f = pick(req.body, spec);
    const out = await tx(async db => {
      const row = await loader(db, req.params.id, uid);
      if (!row || row.deleted_at || row.w_deleted_at) throw httpError(404, `${type === 'set' ? 'Set' : 'Segment'} not found`);
      if (row.w_status === 'cancelled') throw httpError(409, 'This workout was cancelled; reopen it to change it');
      const changes = changesOf(row, f);
      if (!Object.keys(changes).length) return { [type]: strip(row), changes, logged: false };
      const keys = Object.keys(changes);
      const finished = row.w_status === 'completed';
      const r = await db.query(
        `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}${finished ? ', edited_at = NOW()' : ''}
         WHERE id = $${keys.length + 1} RETURNING *`,
        [...keys.map(k => f[k]), row.id]
      );
      if (finished) await logEdit(db, { userId: uid, type, id: row.id, workoutId: row.w_id, action: 'edit', changes });
      if (type === 'segment' && 'notes' in changes) {
        await retagSafely(db, { userId: uid, workoutId: row.w_id, sourceType: 'segment', sourceId: row.id, text: f.notes });
      }
      return { [type]: r.rows[0], changes, logged: finished };
    });
    res.json(out);
  } catch (err) { fail(res, err, `edit ${type}`); }
}

// PATCH /workouts/sets/:id/edit  — also logged by the existing PATCH /workouts/sets/:setId
const editSet = (req, res) => editChild(req, res, { type: 'set', spec: SET_EDIT, loader: loadSet, table: 'workout_sets' });
// PATCH /workouts/cardio-segments/:id
const editSegment = (req, res) => editChild(req, res, { type: 'segment', spec: SEGMENT_EDIT, loader: loadSegment, table: 'workout_cardio_segments' });

// ── Soft delete / restore ─────────────────────────────────────────────────────

const reasonOf = body => {
  const r = V.text(body?.reason, 'reason', 1000, { required: true });
  if (r.error) throw V.badRequest('A reason is required to delete (reason)');
  return r.value;
};

// DELETE /workouts/:workoutId  { reason }
const deleteWorkout = async (req, res) => {
  const uid = req.user.userId;
  try {
    const reason = reasonOf(req.body);
    const out = await tx(async db => {
      const w = await loadWorkout(db, req.params.workoutId, uid, { lock: true });
      if (!w || w.deleted_at) throw httpError(404, 'Workout not found');
      if (w.status === 'in_progress') throw httpError(409, 'Finish or cancel this workout before deleting it');
      const r = await db.query(
        `UPDATE workouts SET deleted_at = NOW(), deleted_reason = $1 WHERE id = $2 RETURNING id, deleted_at, deleted_reason`,
        [reason, w.id]
      );
      await logEdit(db, { userId: uid, type: 'workout', id: w.id, workoutId: w.id, action: 'delete', reason });
      return r.rows[0];
    });
    res.json({ deleted: out });
  } catch (err) { fail(res, err, 'delete workout'); }
};

// POST /workouts/:workoutId/restore
const restoreWorkout = async (req, res) => {
  const uid = req.user.userId;
  try {
    const out = await tx(async db => {
      const w = await loadWorkout(db, req.params.workoutId, uid, { lock: true });
      if (!w) throw httpError(404, 'Workout not found');
      if (!w.deleted_at) throw httpError(409, 'This workout is not deleted');
      await db.query(`UPDATE workouts SET deleted_at = NULL, deleted_reason = NULL WHERE id = $1`, [w.id]);
      await logEdit(db, { userId: uid, type: 'workout', id: w.id, workoutId: w.id, action: 'restore', reason: w.deleted_reason });
      return { id: w.id, restored: true };
    });
    res.json(out);
  } catch (err) { fail(res, err, 'restore workout'); }
};

async function deleteChild(req, res, { type, loader, table }) {
  const uid = req.user.userId;
  try {
    const reason = reasonOf(req.body);
    const out = await tx(async db => {
      const row = await loader(db, req.params.id, uid);
      if (!row || row.deleted_at || row.w_deleted_at) throw httpError(404, `${type === 'set' ? 'Set' : 'Segment'} not found`);
      const r = await db.query(
        `UPDATE ${table} SET deleted_at = NOW(), deleted_reason = $1 WHERE id = $2 RETURNING id, deleted_at, deleted_reason`,
        [reason, row.id]
      );
      await logEdit(db, { userId: uid, type, id: row.id, workoutId: row.w_id, action: 'delete', reason });
      return r.rows[0];
    });
    res.json({ deleted: out });
  } catch (err) { fail(res, err, `delete ${type}`); }
}

async function restoreChild(req, res, { type, loader, table }) {
  const uid = req.user.userId;
  try {
    const out = await tx(async db => {
      const row = await loader(db, req.params.id, uid);
      if (!row) throw httpError(404, `${type === 'set' ? 'Set' : 'Segment'} not found`);
      if (!row.deleted_at) throw httpError(409, `This ${type} is not deleted`);
      await db.query(`UPDATE ${table} SET deleted_at = NULL, deleted_reason = NULL WHERE id = $1`, [row.id]);
      await logEdit(db, { userId: uid, type, id: row.id, workoutId: row.w_id, action: 'restore', reason: row.deleted_reason });
      return { id: row.id, restored: true };
    });
    res.json(out);
  } catch (err) { fail(res, err, `restore ${type}`); }
}

const deleteSet = (req, res) => deleteChild(req, res, { type: 'set', loader: loadSet, table: 'workout_sets' });
const restoreSet = (req, res) => restoreChild(req, res, { type: 'set', loader: loadSet, table: 'workout_sets' });
const deleteSegment = (req, res) => deleteChild(req, res, { type: 'segment', loader: loadSegment, table: 'workout_cardio_segments' });
const restoreSegment = (req, res) => restoreChild(req, res, { type: 'segment', loader: loadSegment, table: 'workout_cardio_segments' });

// GET /workouts/:workoutId/edits — the workout's edit log (also for a deleted workout)
const listEdits = async (req, res) => {
  try {
    const w = await loadWorkout(pool, req.params.workoutId, req.user.userId);
    if (!w) throw httpError(404, 'Workout not found');
    const r = await pool.query(
      `SELECT id, record_type, record_id, action, changes, reason, created_at FROM record_edits
       WHERE workout_id = $1 AND user_id = $2 ORDER BY created_at, id`,
      [w.id, req.user.userId]
    );
    res.json({ workout_id: w.id, edited_at: w.edited_at, deleted_at: w.deleted_at, edits: r.rows });
  } catch (err) { fail(res, err, 'list edits'); }
};

// GET /workouts/deleted — the user's soft-deleted workouts, sets and segments (for undo)
const listDeleted = async (req, res) => {
  const uid = req.user.userId;
  try {
    const [w, s, g] = await Promise.all([
      pool.query(`SELECT id, to_char(workout_date, 'YYYY-MM-DD') AS workout_date, workout_title, workout_type, status, deleted_at, deleted_reason
                  FROM workouts WHERE user_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`, [uid]),
      pool.query(`SELECT ws.id, we.workout_id, we.exercise_id, ws.set_number, ws.reps_completed, ws.weight_used, ws.deleted_at, ws.deleted_reason
                  FROM workout_sets ws JOIN workout_exercises we ON we.id = ws.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
                  WHERE w.user_id = $1 AND ws.deleted_at IS NOT NULL ORDER BY ws.deleted_at DESC`, [uid]),
      pool.query(`SELECT s.id, s.workout_id, s.workout_exercise_id, s.segment_number, s.duration_seconds, s.distance, s.deleted_at, s.deleted_reason
                  FROM workout_cardio_segments s JOIN workouts w ON w.id = s.workout_id
                  WHERE w.user_id = $1 AND s.deleted_at IS NOT NULL ORDER BY s.deleted_at DESC`, [uid]),
    ]);
    res.json({ workouts: w.rows, sets: s.rows, segments: g.rows });
  } catch (err) { fail(res, err, 'list deleted'); }
};

module.exports = {
  editWorkout, editSet, editSegment, deleteWorkout, restoreWorkout, deleteSet, restoreSet, deleteSegment, restoreSegment,
  listEdits, listDeleted, changesOf, logEdit,
};
