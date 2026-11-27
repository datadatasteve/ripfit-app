// backend/src/controllers/circuitController.js
// Circuit blocks (Phase 1A-1): a group of movements done back to back for a
// number of rounds. A circuit lives in a routine (template) or a workout
// (instance). Only a name and a logging mode are required, so a circuit added
// on the fly mid-workout can be filled in later.
//
// Logging modes: 'completion' (tick rounds, or movements within a round, as
// done) and 'full' (reps and weight per movement per round). Round logs live
// in circuit_round_logs, not workout_sets, so stats are unchanged by circuits.
const { pool } = require('../config/database');
const V = require('../utils/validate');

const LOGGING_MODES = ['completion', 'full'];

/** Circuits with movements and round logs, for a routine or a workout. */
async function loadCircuits(db, { routineId = null, workoutId = null, circuitId = null }) {
  const where = circuitId ? 'c.id = $1' : routineId ? 'c.routine_id = $1' : 'c.workout_id = $1';
  const key = circuitId || routineId || workoutId;
  const result = await db.query(
    `SELECT c.*,
            COALESCE((SELECT json_agg(json_build_object(
                'id', m.id, 'exercise_id', m.exercise_id, 'exercise_name', e.name, 'name', m.name,
                'order_index', m.order_index, 'target_reps', m.target_reps,
                'target_weight', m.target_weight::float, 'target_seconds', m.target_seconds,
                'target_distance', m.target_distance::float, 'target_distance_unit', m.target_distance_unit,
                'target_rpe', m.target_rpe, 'notes', m.notes, 'micro_overload', m.micro_overload)
              ORDER BY m.order_index, m.id)
              FROM circuit_movements m LEFT JOIN exercises e ON e.id = m.exercise_id
              WHERE m.circuit_id = c.id), '[]'::json) AS movements,
            COALESCE((SELECT json_agg(json_build_object(
                'id', l.id, 'movement_id', l.movement_id, 'round_number', l.round_number,
                'completed', l.completed, 'reps', l.reps, 'weight', l.weight::float,
                'duration_seconds', l.duration_seconds, 'distance', l.distance::float,
                'rpe', l.rpe, 'logged_at', l.logged_at)
              ORDER BY l.round_number, l.movement_id NULLS FIRST)
              FROM circuit_round_logs l WHERE l.circuit_id = c.id), '[]'::json) AS round_logs
     FROM circuits c
     WHERE ${where}
     ORDER BY c.order_index NULLS LAST, c.id`,
    [key]
  );
  return result.rows.map(c => ({
    ...c,
    completed: !!c.completed_at,
    rounds_logged: new Set(c.round_logs.filter(l => l.completed).map(l => l.round_number)).size,
  }));
}

/** Copies a routine's circuits into a new workout (called by the start endpoints). */
async function copyRoutineCircuits(db, routineId, workoutId, userId) {
  const src = await db.query(`SELECT * FROM circuits WHERE routine_id = $1 ORDER BY order_index NULLS LAST, id`, [routineId]);
  for (const c of src.rows) {
    const ins = await db.query(
      `INSERT INTO circuits (user_id, workout_id, source_circuit_id, name, logging_mode, rounds,
                             work_seconds, rest_seconds, order_index, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [userId, workoutId, c.id, c.name, c.logging_mode, c.rounds, c.work_seconds, c.rest_seconds, c.order_index, c.notes]
    );
    await db.query(
      `INSERT INTO circuit_movements (circuit_id, exercise_id, name, order_index, target_reps, target_weight,
              target_seconds, target_distance, target_distance_unit, target_rpe, notes, micro_overload)
       SELECT $1, exercise_id, name, order_index, target_reps, target_weight, target_seconds, target_distance,
              target_distance_unit, target_rpe, notes, micro_overload
       FROM circuit_movements WHERE circuit_id = $2 ORDER BY order_index, id`,
      [ins.rows[0].id, c.id]
    );
  }
  return src.rows.length ? loadCircuits(db, { workoutId }) : [];
}

// ── Validation ────────────────────────────────────────────────────────────────

function circuitFields(body, { creating }) {
  const out = {};
  if (creating || 'name' in body) out.name = V.take(V.text(body.name, 'name', 200, { required: true }));
  if (creating || 'logging_mode' in body) out.logging_mode = V.take(V.oneOf(body.logging_mode, 'logging_mode', LOGGING_MODES, { required: true }));
  if ('rounds' in body) out.rounds = V.take(V.intIn(body.rounds, 'rounds', 1, 1000));
  if ('work_seconds' in body) out.work_seconds = V.take(V.intIn(body.work_seconds, 'work_seconds', 0, 86400));
  if ('rest_seconds' in body) out.rest_seconds = V.take(V.intIn(body.rest_seconds, 'rest_seconds', 0, 86400));
  if ('order_index' in body) out.order_index = V.take(V.intIn(body.order_index, 'order_index', 0, 10000));
  if ('notes' in body) out.notes = V.take(V.text(body.notes, 'notes', 5000));
  return out;
}

function movementFields(m, i) {
  if (!m || typeof m !== 'object') throw V.badRequest(`movements[${i}] must be an object`);
  const p = `movements[${i}].`;
  const out = {
    exercise_id: V.take(V.intIn(m.exercise_id, `${p}exercise_id`, 1, 2147483647)),
    name: V.take(V.text(m.name, `${p}name`, 200)),
    order_index: V.take(V.intIn(m.order_index, `${p}order_index`, 0, 10000)) ?? i + 1,
    target_reps: V.take(V.intIn(m.target_reps, `${p}target_reps`, 0, 100000)),
    target_weight: V.take(V.numMin(m.target_weight, `${p}target_weight`, 0, { max: 99999 })),
    target_seconds: V.take(V.intIn(m.target_seconds, `${p}target_seconds`, 0, 86400)),
    target_distance: V.take(V.numMin(m.target_distance, `${p}target_distance`, 0, { max: 9999999 })),
    target_distance_unit: V.take(V.text(m.target_distance_unit, `${p}target_distance_unit`, 20)),
    target_rpe: V.take(V.rpeTarget(m.target_rpe, `${p}target_rpe`)),
    notes: V.take(V.text(m.notes, `${p}notes`, 5000)),
    micro_overload: V.take(V.microOverload(m.micro_overload)),
  };
  if (!out.exercise_id && !out.name) throw V.badRequest(`${p}exercise_id or ${p}name is required`);
  out.id = m.id === undefined || m.id === null ? null : V.take(V.intIn(m.id, `${p}id`, 1, 2147483647));
  return out;
}

const MOVEMENT_COLS = ['exercise_id', 'name', 'order_index', 'target_reps', 'target_weight', 'target_seconds',
  'target_distance', 'target_distance_unit', 'target_rpe', 'notes', 'micro_overload'];
const mv = (m, c) => (c === 'micro_overload' && m[c] ? JSON.stringify(m[c]) : m[c]);

/** Replaces a circuit's movements: rows with an id are updated (logs kept), new ones inserted, missing ones removed. */
async function writeMovements(db, circuitId, movements) {
  const list = movements.map(movementFields);
  const exIds = [...new Set(list.map(m => m.exercise_id).filter(Boolean))];
  if (exIds.length) {
    const found = await db.query(`SELECT id FROM exercises WHERE id = ANY($1::int[])`, [exIds]);
    const ok = new Set(found.rows.map(r => r.id));
    const missing = exIds.filter(id => !ok.has(id));
    if (missing.length) throw V.badRequest(`Exercise not found: ${missing.join(', ')}`);
  }
  const existing = await db.query(`SELECT id FROM circuit_movements WHERE circuit_id = $1`, [circuitId]);
  const existingIds = new Set(existing.rows.map(r => r.id));
  for (const m of list) {
    if (m.id && !existingIds.has(m.id)) throw V.badRequest(`Movement ${m.id} is not part of this circuit`);
  }
  const keep = list.filter(m => m.id).map(m => m.id);
  await db.query(`DELETE FROM circuit_movements WHERE circuit_id = $1 AND NOT (id = ANY($2::int[]))`, [circuitId, keep]);
  for (const m of list) {
    if (m.id) {
      await db.query(
        `UPDATE circuit_movements SET ${MOVEMENT_COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
         WHERE id = $${MOVEMENT_COLS.length + 1}`,
        [...MOVEMENT_COLS.map(c => mv(m, c)), m.id]
      );
    } else {
      await db.query(
        `INSERT INTO circuit_movements (circuit_id, ${MOVEMENT_COLS.join(', ')})
         VALUES ($1, ${MOVEMENT_COLS.map((_, i) => `$${i + 2}`).join(', ')})`,
        [circuitId, ...MOVEMENT_COLS.map(c => mv(m, c))]
      );
    }
  }
}

/** The circuit if it belongs to the user, else null. */
async function ownCircuit(db, id, userId) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const r = await db.query(`SELECT * FROM circuits WHERE id = $1 AND user_id = $2`, [n, userId]);
  return r.rows[0] || null;
}

function fail(res, err, what) {
  if (err.statusCode === 400) return res.status(400).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// GET /circuits?routine_id= | ?workout_id=
const listCircuits = async (req, res) => {
  const uid = req.user.userId;
  const routineId = V.intIn(req.query.routine_id, 'routine_id', 1, 2147483647);
  const workoutId = V.intIn(req.query.workout_id, 'workout_id', 1, 2147483647);
  if (routineId.error || workoutId.error) return res.status(400).json({ error: routineId.error || workoutId.error });
  if (!!routineId.value === !!workoutId.value) return res.status(400).json({ error: 'Give exactly one of routine_id or workout_id' });
  try {
    const owner = routineId.value
      ? await pool.query(`SELECT id FROM workout_routines WHERE id = $1 AND user_id = $2`, [routineId.value, uid])
      : await pool.query(`SELECT id FROM workouts WHERE id = $1 AND user_id = $2`, [workoutId.value, uid]);
    if (!owner.rows.length) return res.status(404).json({ error: routineId.value ? 'Routine not found' : 'Workout not found' });
    res.json({ circuits: await loadCircuits(pool, { routineId: routineId.value, workoutId: workoutId.value }) });
  } catch (err) { fail(res, err, 'list circuits'); }
};

// POST /circuits
const createCircuit = async (req, res) => {
  const uid = req.user.userId;
  const body = req.body || {};
  const client = await pool.connect();
  try {
    const routineId = V.take(V.intIn(body.routine_id, 'routine_id', 1, 2147483647));
    const workoutId = V.take(V.intIn(body.workout_id, 'workout_id', 1, 2147483647));
    if (!!routineId === !!workoutId) throw V.badRequest('Give exactly one of routine_id or workout_id');
    const f = circuitFields(body, { creating: true });
    if ('movements' in body && !Array.isArray(body.movements)) throw V.badRequest('movements must be a list');

    await client.query('BEGIN');
    const owner = routineId
      ? await client.query(`SELECT id FROM workout_routines WHERE id = $1 AND user_id = $2`, [routineId, uid])
      : await client.query(`SELECT id FROM workouts WHERE id = $1 AND user_id = $2`, [workoutId, uid]);
    if (!owner.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: routineId ? 'Routine not found' : 'Workout not found' });
    }
    const cols = ['user_id', 'routine_id', 'workout_id', ...Object.keys(f)];
    const vals = [uid, routineId, workoutId, ...Object.values(f)];
    const ins = await client.query(
      `INSERT INTO circuits (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      vals
    );
    if (Array.isArray(body.movements)) await writeMovements(client, ins.rows[0].id, body.movements);
    await client.query('COMMIT');
    const [circuit] = await loadCircuits(pool, { circuitId: ins.rows[0].id });
    res.status(201).json({ circuit });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'create circuit');
  } finally { client.release(); }
};

// GET /circuits/:id
const getCircuit = async (req, res) => {
  try {
    const c = await ownCircuit(pool, req.params.id, req.user.userId);
    if (!c) return res.status(404).json({ error: 'Circuit not found' });
    const [circuit] = await loadCircuits(pool, { circuitId: c.id });
    res.json({ circuit });
  } catch (err) { fail(res, err, 'get circuit'); }
};

// PUT /circuits/:id — any circuit field, `movements` (replace), `completed` (workout circuits)
const updateCircuit = async (req, res) => {
  const uid = req.user.userId;
  const body = req.body || {};
  const client = await pool.connect();
  try {
    const f = circuitFields(body, { creating: false });
    const completed = V.take(V.bool(body.completed, 'completed'));
    if ('movements' in body && !Array.isArray(body.movements)) throw V.badRequest('movements must be a list');
    await client.query('BEGIN');
    const c = await ownCircuit(client, req.params.id, uid);
    if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Circuit not found' }); }
    if (completed !== null && !c.workout_id) throw V.badRequest('Only a circuit in a workout can be completed');
    const sets = Object.keys(f).map((k, i) => `${k} = $${i + 1}`);
    const vals = Object.values(f);
    if (completed === true) sets.push('completed_at = COALESCE(completed_at, NOW())');
    if (completed === false) sets.push('completed_at = NULL');
    sets.push('updated_at = NOW()');
    await client.query(`UPDATE circuits SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, c.id]);
    if (Array.isArray(body.movements)) await writeMovements(client, c.id, body.movements);
    await client.query('COMMIT');
    const [circuit] = await loadCircuits(pool, { circuitId: c.id });
    res.json({ circuit });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'update circuit');
  } finally { client.release(); }
};

// DELETE /circuits/:id
const deleteCircuit = async (req, res) => {
  try {
    const c = await ownCircuit(pool, req.params.id, req.user.userId);
    if (!c) return res.status(404).json({ error: 'Circuit not found' });
    await pool.query(`DELETE FROM circuits WHERE id = $1`, [c.id]);
    res.json({ message: 'Circuit deleted' });
  } catch (err) { fail(res, err, 'delete circuit'); }
};

// POST /circuits/:id/complete — completes a workout circuit (no details needed)
const completeCircuit = async (req, res) => {
  try {
    const c = await ownCircuit(pool, req.params.id, req.user.userId);
    if (!c) return res.status(404).json({ error: 'Circuit not found' });
    if (!c.workout_id) return res.status(400).json({ error: 'Only a circuit in a workout can be completed' });
    await pool.query(`UPDATE circuits SET completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() WHERE id = $1`, [c.id]);
    const [circuit] = await loadCircuits(pool, { circuitId: c.id });
    res.json({ circuit });
  } catch (err) { fail(res, err, 'complete circuit'); }
};

// PUT /circuits/:id/rounds/:round — log (upsert) one round, or one movement in a round
const logRound = async (req, res) => {
  const body = req.body || {};
  try {
    const round = V.take(V.intIn(req.params.round, 'round', 1, 1000, { required: true }));
    const movementId = V.take(V.intIn(body.movement_id, 'movement_id', 1, 2147483647));
    const completed = V.take(V.bool(body.completed, 'completed'));
    const vals = {
      reps: V.take(V.intIn(body.reps, 'reps', 0, 100000)),
      weight: V.take(V.numMin(body.weight, 'weight', 0, { max: 99999 })),
      duration_seconds: V.take(V.intIn(body.duration_seconds, 'duration_seconds', 0, 86400)),
      distance: V.take(V.numMin(body.distance, 'distance', 0, { max: 9999999 })),
      rpe: V.take(V.intIn(body.rpe, 'rpe', 1, 11)),
    };
    const c = await ownCircuit(pool, req.params.id, req.user.userId);
    if (!c) return res.status(404).json({ error: 'Circuit not found' });
    if (!c.workout_id) return res.status(400).json({ error: 'Rounds are logged on a circuit in a workout, not on a routine template' });
    if (c.logging_mode === 'full' && !movementId) {
      return res.status(400).json({ error: 'This circuit logs each movement: movement_id is required' });
    }
    if (movementId) {
      const m = await pool.query(`SELECT id FROM circuit_movements WHERE id = $1 AND circuit_id = $2`, [movementId, c.id]);
      if (!m.rows.length) return res.status(400).json({ error: 'movement_id is not part of this circuit' });
    }
    const existing = await pool.query(
      `SELECT id FROM circuit_round_logs WHERE circuit_id = $1 AND round_number = $2 AND COALESCE(movement_id, 0) = $3`,
      [c.id, round, movementId || 0]
    );
    if (existing.rows.length) {
      await pool.query(
        `UPDATE circuit_round_logs SET completed = COALESCE($1, completed), reps = $2, weight = $3,
                duration_seconds = $4, distance = $5, rpe = $6, logged_at = NOW() WHERE id = $7`,
        [completed, vals.reps, vals.weight, vals.duration_seconds, vals.distance, vals.rpe, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO circuit_round_logs (circuit_id, movement_id, round_number, completed, reps, weight, duration_seconds, distance, rpe)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [c.id, movementId, round, completed ?? true, vals.reps, vals.weight, vals.duration_seconds, vals.distance, vals.rpe]
      );
    }
    const [circuit] = await loadCircuits(pool, { circuitId: c.id });
    res.json({ circuit });
  } catch (err) { fail(res, err, 'log circuit round'); }
};

// DELETE /circuits/:id/rounds/:round?movement_id=
const deleteRound = async (req, res) => {
  try {
    const round = V.take(V.intIn(req.params.round, 'round', 1, 1000, { required: true }));
    const movementId = V.take(V.intIn(req.query.movement_id, 'movement_id', 1, 2147483647));
    const c = await ownCircuit(pool, req.params.id, req.user.userId);
    if (!c) return res.status(404).json({ error: 'Circuit not found' });
    const del = await pool.query(
      `DELETE FROM circuit_round_logs WHERE circuit_id = $1 AND round_number = $2 AND COALESCE(movement_id, 0) = $3 RETURNING id`,
      [c.id, round, movementId || 0]
    );
    if (!del.rows.length) return res.status(404).json({ error: 'Round log not found' });
    const [circuit] = await loadCircuits(pool, { circuitId: c.id });
    res.json({ circuit });
  } catch (err) { fail(res, err, 'delete circuit round'); }
};

module.exports = {
  loadCircuits, copyRoutineCircuits,
  listCircuits, createCircuit, getCircuit, updateCircuit, deleteCircuit, completeCircuit, logRound, deleteRound,
};
