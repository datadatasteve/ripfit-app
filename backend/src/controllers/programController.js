// backend/src/controllers/programController.js
const { pool } = require('../config/database');
const { durationSql, recordSessionEvent } = require('../utils/workoutStatus');
const V = require('../utils/validate');
const { cleanExerciseName, findOrCreateExerciseByName } = require('../utils/customExercise');
const { insertRoutineExercise } = require('./routineController');
const { copyRoutineCircuits } = require('./circuitController');
const { WORKOUT_DAY_SQL, loadSchedule, todayIn, effectiveDayType, addDays, dbDate } = require('../utils/programSchedule');

// ── Helpers ───────────────────────────────────────────────────────────────────

function userId(req) { return req.user.userId; }

// A program_workouts row only counts as "done" when its workout completed.
// Rows pointing at an in-progress or cancelled workout (e.g. recorded through
// POST /complete, or before Phase 0A-1) are ignored everywhere.
const pwDone = (pw) =>
  `EXISTS (SELECT 1 FROM (SELECT * FROM workouts WHERE deleted_at IS NULL) pw_w WHERE pw_w.id = ${pw}.workout_id AND pw_w.status = 'completed')`;

// ── Phase 1A-1 helpers ────────────────────────────────────────────────────────

/** A 400 from a validator becomes a 400 response; anything else a 500. */
function fail(res, err, what) {
  if (err.statusCode === 400) return res.status(400).json({ error: err.message });
  if (err.statusCode === 404) return res.status(404).json({ error: err.message });
  if (err.statusCode === 409) return res.status(409).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });

/** The user's program row, or null (also null for a malformed id). */
async function ownProgram(db, id, uid) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) return null;
  const r = await db.query(`SELECT * FROM programs WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0] || null;
}

// Program-level fields added in 1A-1. Only keys present in the body change.
function programNewFields(body) {
  const out = {};
  if ('schedule_mode' in body && !V.isBlank(body.schedule_mode)) {
    out.schedule_mode = V.take(V.oneOf(body.schedule_mode, 'schedule_mode', ['fixed', 'flexible']));
  }
  if ('workouts_per_week' in body) out.workouts_per_week = V.take(V.intIn(body.workouts_per_week, 'workouts_per_week', 1, 14));
  if ('color' in body) out.color = V.take(V.hexColor(body.color));
  if ('overview' in body) out.overview = V.take(V.text(body.overview, 'overview', 20000));
  if ('is_pinned' in body) {
    const pin = V.take(V.bool(body.is_pinned, 'is_pinned'));
    if (pin !== null) out.is_pinned = pin;
  }
  return out;
}

async function applyProgramNewFields(db, programId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  if ('is_pinned' in fields) sets.push(fields.is_pinned ? 'pinned_at = COALESCE(pinned_at, NOW())' : 'pinned_at = NULL');
  const r = await db.query(
    `UPDATE programs SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(fields), programId]
  );
  return r.rows[0];
}

// Day columns added in 1A-1 (program_routines). A day sent without one of
// these keys keeps the value its previous row had (update replaces all rows),
// so the current program builder, which doesn't know them, can't wipe them.
const DAY_NEW_COLUMNS = ['day_type', 'title', 'is_one_off', 'scheduled_date', 'time_of_day', 'planned_time', 'special_tag', 'special_note'];
const DAY_CHECKS = {
  day_type: (v, f) => V.oneOf(v, f, ['workout', 'rest_day', 'single_event', 'open_day']),
  title: (v, f) => V.text(v, f, 200),
  is_one_off: (v, f) => V.bool(v, f),
  scheduled_date: (v, f) => V.dateStr(v, f),
  time_of_day: (v, f) => V.oneOf(v, f, ['morning', 'afternoon', 'evening']),
  planned_time: (v, f) => V.clockTime(v, f),
  special_tag: (v, f) => V.oneOf(v, f, ['pr_day', 'trial', 'evaluation', 'milestone']),
  special_note: (v, f) => V.text(v, f, 2000),
};

const dayKey = d => `${d.week_number || 1}|${d.day_of_week ?? ''}|${d.order_index || 1}`;

/** Validates one day and merges the new columns with its previous row. */
function buildDay(day, i, previous) {
  if (!day || typeof day !== 'object') throw V.badRequest(`days[${i}] must be an object`);
  const out = {
    routine_id: day.routine_id || null,
    week_number: day.week_number || 1,
    day_of_week: day.day_of_week ?? null,
    order_index: day.order_index || 1,
    is_rest_day: day.is_rest_day || false,
    notes: day.notes || null,
  };
  for (const col of DAY_NEW_COLUMNS) {
    if (col in day) out[col] = V.take(DAY_CHECKS[col](day[col], `days[${i}].${col}`));
    else if (previous) out[col] = previous[col] ?? null;
    else out[col] = null;
    if (col === 'is_one_off') out[col] = !!out[col];
    if (col === 'scheduled_date' && out[col] instanceof Date) out[col] = dbDate(out[col]);
  }
  // day_type and is_rest_day agree (day_type NULL keeps the old meaning).
  if (out.day_type === 'rest_day') out.is_rest_day = true;
  else if (out.day_type) out.is_rest_day = false;
  if (out.day_type === 'workout' && !out.routine_id) throw V.badRequest(`days[${i}]: a workout day needs a routine_id`);
  if (out.day_type === 'single_event' && !out.title) throw V.badRequest(`days[${i}]: a single event needs a title`);
  if (out.is_one_off && (!out.routine_id || !out.scheduled_date)) {
    throw V.badRequest(`days[${i}]: a one-off routine needs a routine_id and a scheduled_date`);
  }
  if (out.planned_time && out.time_of_day) {
    throw V.badRequest(`days[${i}]: give time_of_day (morning/afternoon/evening) or planned_time (a clock time), not both`);
  }
  return out;
}

/** Inserts the program's days (validated first, so a bad day writes nothing). Returns new ids by previous id. */
async function writeDays(client, programId, days, previousRows = []) {
  const byId = new Map(previousRows.map(r => [r.id, r]));
  const byKey = new Map();
  for (const r of previousRows) { const k = dayKey(r); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  const used = new Set();
  const built = days.map((day, i) => {
    let prev = null;
    const idN = Number(day?.id);
    if (Number.isInteger(idN) && byId.has(idN) && !used.has(idN)) prev = byId.get(idN);
    if (!prev) prev = (byKey.get(dayKey(day || {})) || []).find(r => !used.has(r.id)) || null;
    if (prev) used.add(prev.id);
    return { row: buildDay(day, i, prev), prevId: prev?.id || null };
  });
  const cols = ['program_id', 'routine_id', 'week_number', 'day_of_week', 'order_index', 'is_rest_day', 'notes', ...DAY_NEW_COLUMNS];
  const relinks = [];
  for (const { row, prevId } of built) {
    const vals = [programId, ...cols.slice(1).map(c => row[c])];
    const ins = await client.query(
      `INSERT INTO program_routines (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      vals
    );
    if (prevId) relinks.push([prevId, ins.rows[0].id]);
  }
  return relinks;
}

/**
 * New exercises sent with a program (Phase 1A-1, owner decision: attached to a
 * routine used on one of the program's days). Each is created with the custom
 * exercise rule (an existing exercise of the same name is reused) and added to
 * the end of that routine.
 */
function parseNewExercises(body) {
  if (!('new_exercises' in body) || body.new_exercises === null) return [];
  if (!Array.isArray(body.new_exercises)) throw V.badRequest('new_exercises must be a list');
  return body.new_exercises.map((ex, i) => {
    if (!ex || typeof ex !== 'object') throw V.badRequest(`new_exercises[${i}] must be an object`);
    const name = cleanExerciseName(ex.name);
    if (!name) throw V.badRequest(`new_exercises[${i}].name is required`);
    if (name.length > 255) throw V.badRequest(`new_exercises[${i}].name is too long`);
    const routineId = V.take(V.intIn(ex.routine_id, `new_exercises[${i}].routine_id`, 1, 2147483647, { required: true }));
    return {
      name,
      routine_id: routineId,
      category: V.take(V.text(ex.category, `new_exercises[${i}].category`, 50)),
      equipment_type: V.take(V.text(ex.equipment_type, `new_exercises[${i}].equipment_type`, 50)),
      targets: Object.fromEntries(['target_sets', 'target_reps_min', 'target_reps_max', 'target_weight', 'target_rpe',
        'notes', 'cooldown_seconds', 'micro_overload'].filter(k => k in ex).map(k => [k, ex[k]])),
    };
  });
}

async function attachNewExercises(client, programId, uid, list) {
  if (!list.length) return [];
  const used = await client.query(
    `SELECT DISTINCT pr.routine_id FROM program_routines pr
     JOIN workout_routines wr ON wr.id = pr.routine_id AND wr.user_id = $2
     WHERE pr.program_id = $1 AND pr.routine_id IS NOT NULL`,
    [programId, uid]
  );
  const routineIds = new Set(used.rows.map(r => r.routine_id));
  const out = [];
  for (const [i, ex] of list.entries()) {
    if (!routineIds.has(ex.routine_id)) {
      throw V.badRequest(`new_exercises[${i}].routine_id must be one of your routines used on a day of this program`);
    }
    const found = await findOrCreateExerciseByName(client, ex.name, uid, { category: ex.category, equipmentType: ex.equipment_type });
    const next = await client.query(
      `SELECT COALESCE(MAX(order_index), 0) + 1 AS n FROM routine_exercises WHERE routine_id = $1`, [ex.routine_id]
    );
    const re = await insertRoutineExercise(client, ex.routine_id,
      { ...ex.targets, exercise_id: found.id, order_index: next.rows[0].n });
    out.push({ exercise_id: found.id, name: found.name, created: found.created, routine_id: ex.routine_id, routine_exercise_id: re.id });
  }
  return out;
}

// ── Programs CRUD ─────────────────────────────────────────────────────────────

const createProgram = async (req, res) => {
  const { name, description, synopsis, duration_weeks, start_date, schedule_shift_pref, days,
          overload_strategy, overload_increment } = req.body;
  const uid = userId(req);
  if (!name) return res.status(400).json({ error: 'name required' });

  let newFields; let newExercises;
  try {
    newFields = programNewFields(req.body);
    newExercises = parseNewExercises(req.body);
    if (days !== undefined && days !== null && !Array.isArray(days)) throw V.badRequest('days must be a list');
  } catch (err) {
    return fail(res, err, 'create program');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prog = await client.query(
      `INSERT INTO programs (user_id, name, description, synopsis, duration_weeks, start_date, status,
                             schedule_shift_pref, overload_strategy, overload_increment)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING *`,
      [uid, name, description || null, synopsis || null, duration_weeks || null,
       start_date || null, schedule_shift_pref || 'none',
       overload_strategy || 'none',
       overload_increment != null && overload_increment !== '' ? overload_increment : null]
    );

    let program = prog.rows[0];
    program = (await applyProgramNewFields(client, program.id, newFields)) || program;

    // Insert program days if provided
    if (Array.isArray(days) && days.length > 0) {
      await writeDays(client, program.id, days);
    }
    const createdExercises = await attachNewExercises(client, program.id, uid, newExercises);

    await client.query('COMMIT');
    res.status(201).json({ program, ...(newExercises.length ? { new_exercises: createdExercises } : {}) });
  } catch (err) {
    await client.query('ROLLBACK');
    fail(res, err, 'create program');
  } finally {
    client.release();
  }
};

const getPrograms = async (req, res) => {
  const uid = userId(req);
  try {
    const result = await pool.query(
      `SELECT p.*,
        COUNT(DISTINCT pr.id) FILTER (WHERE ${WORKOUT_DAY_SQL('pr')}) AS total_workout_days,
        COUNT(DISTINCT pw.id) AS completed_workouts
       FROM programs p
       LEFT JOIN program_routines pr ON pr.program_id = p.id
       LEFT JOIN program_workouts pw ON pw.program_id = p.id AND ${pwDone('pw')}
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.status = 'active' DESC, p.updated_at DESC`,
      [uid]
    );
    res.json({ programs: result.rows });
  } catch (err) {
    console.error('getPrograms error:', err);
    res.status(500).json({ error: 'Failed to get programs' });
  }
};

const getProgramById = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;
  try {
    const progResult = await pool.query(
      `SELECT p.*,
        COUNT(DISTINCT pr.id) FILTER (WHERE ${WORKOUT_DAY_SQL('pr')}) AS total_workout_days,
        COUNT(DISTINCT pw.id) AS completed_workouts
       FROM programs p
       LEFT JOIN program_routines pr ON pr.program_id = p.id
       LEFT JOIN program_workouts pw ON pw.program_id = p.id AND ${pwDone('pw')}
       WHERE p.id = $1 AND p.user_id = $2
       GROUP BY p.id`,
      [id, uid]
    );
    if (progResult.rows.length === 0) return res.status(404).json({ error: 'Program not found' });

    const program = progResult.rows[0];

    // Get days with routine info (and, since 1A-1, the day's skip record).
    // Use a lateral subquery for the program_workouts join to:
    //   1. Scope the lookup to this program (prevents cross-program contamination)
    //   2. Guarantee at most one row per program_routine (avoids GROUP BY fan-out
    //      that could produce duplicate day rows if the unique constraint is missing)
    const daysResult = await pool.query(
      `SELECT pr.*, wr.name AS routine_name, wr.description AS routine_description,
        COUNT(re.id) AS exercise_count,
        latest_pw.completed_date, latest_pw.workout_id AS completed_workout_id,
        (SELECT json_build_object('reason', sk.reason, 'skipped_at', sk.skipped_at, 'scheduled_date', sk.scheduled_date)
         FROM program_day_skips sk WHERE sk.program_routine_id = pr.id) AS skip
       FROM program_routines pr
       LEFT JOIN workout_routines wr ON wr.id = pr.routine_id
       LEFT JOIN routine_exercises re ON re.routine_id = wr.id
       LEFT JOIN LATERAL (
         SELECT pw.completed_date, pw.workout_id
         FROM program_workouts pw
         WHERE pw.program_routine_id = pr.id AND pw.program_id = $1 AND ${pwDone('pw')}
         ORDER BY pw.completed_date DESC
         LIMIT 1
       ) latest_pw ON TRUE
       WHERE pr.program_id = $1
       GROUP BY pr.id, wr.name, wr.description, latest_pw.completed_date, latest_pw.workout_id
       ORDER BY pr.week_number, pr.day_of_week, pr.order_index`,
      [id]
    );

    // Get journal entries
    const journalResult = await pool.query(
      `SELECT * FROM program_journal_entries WHERE program_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    // Phase 1A-1: phases, documents and pauses as added fields.
    const [phases, legend, sources, pauses] = await Promise.all([
      loadPhases(pool, program),
      pool.query(`SELECT id, label, description, order_index FROM program_legend_items WHERE program_id = $1 ORDER BY order_index, id`, [id]),
      pool.query(`SELECT id, title, url, note, order_index FROM program_sources WHERE program_id = $1 ORDER BY order_index, id`, [id]),
      pool.query(`SELECT * FROM program_pauses WHERE program_id = $1 ORDER BY from_date, id`, [id]),
    ]);

    res.json({
      ...program, days: daysResult.rows, journal: journalResult.rows,
      phases, legend: legend.rows, sources: sources.rows, pauses: pauses.rows,
    });
  } catch (err) {
    console.error('getProgramById error:', err);
    res.status(500).json({ error: 'Failed to get program' });
  }
};

const updateProgram = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;
  const { name, description, synopsis, duration_weeks, start_date, status, schedule_shift_pref, days,
          overload_strategy, overload_increment } = req.body;

  let newFields; let newExercises;
  try {
    newFields = programNewFields(req.body);
    newExercises = parseNewExercises(req.body);
    if (days !== undefined && days !== null && !Array.isArray(days)) throw V.badRequest('days must be a list');
  } catch (err) {
    return fail(res, err, 'update program');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE programs SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        synopsis = COALESCE($3, synopsis),
        duration_weeks = COALESCE($4, duration_weeks),
        start_date = COALESCE($5, start_date),
        status = COALESCE($6, status),
        schedule_shift_pref = COALESCE($7, schedule_shift_pref),
        overload_strategy = COALESCE($8, overload_strategy),
        overload_increment = COALESCE($9, overload_increment),
        updated_at = NOW()
       WHERE id = $10 AND user_id = $11 RETURNING *`,
      [name, description, synopsis, duration_weeks, start_date, status, schedule_shift_pref,
       overload_strategy || null,
       overload_increment != null && overload_increment !== '' ? overload_increment : null,
       id, uid]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Program not found' });
    }

    const program = (await applyProgramNewFields(client, result.rows[0].id, newFields)) || result.rows[0];

    // Replace days if provided. New rows are written first, so a day's skip
    // record (1A-1) can move to its new row before the old rows are deleted.
    if (Array.isArray(days)) {
      const previous = await client.query(`SELECT * FROM program_routines WHERE program_id = $1`, [program.id]);
      const relinks = await writeDays(client, program.id, days, previous.rows);
      for (const [oldId, newId] of relinks) {
        await client.query(`UPDATE program_day_skips SET program_routine_id = $1 WHERE program_routine_id = $2`, [newId, oldId]);
      }
      const prevIds = previous.rows.map(r => r.id);
      if (prevIds.length) await client.query(`DELETE FROM program_routines WHERE id = ANY($1::int[])`, [prevIds]);
    }
    const createdExercises = await attachNewExercises(client, program.id, uid, newExercises);

    await client.query('COMMIT');
    res.json({ program, ...(newExercises.length ? { new_exercises: createdExercises } : {}) });
  } catch (err) {
    await client.query('ROLLBACK');
    fail(res, err, 'update program');
  } finally {
    client.release();
  }
};

const deleteProgram = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM programs WHERE id = $1 AND user_id = $2 RETURNING id`, [id, uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    res.json({ message: 'Program deleted' });
  } catch (err) {
    console.error('deleteProgram error:', err);
    res.status(500).json({ error: 'Failed to delete program' });
  }
};

// ── Program start / activate ──────────────────────────────────────────────────

const activateProgram = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;
  const { start_date } = req.body;
  try {
    const result = await pool.query(
      `UPDATE programs SET status = 'active', start_date = COALESCE($1, start_date), updated_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [start_date || null, id, uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    res.json({ program: result.rows[0] });
  } catch (err) {
    console.error('activateProgram error:', err);
    res.status(500).json({ error: 'Failed to activate program' });
  }
};

// ── Start workout from program day ────────────────────────────────────────────

const startProgramWorkout = async (req, res) => {
  const uid = userId(req);
  const { programId, programRoutineId } = req.params;
  const { workout_date } = req.body;

  if (!workout_date) return res.status(400).json({ error: 'workout_date required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify program belongs to user and day belongs to program
    const dayResult = await client.query(
      `SELECT pr.*, wr.name AS routine_name, p.name AS program_name
       FROM program_routines pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN workout_routines wr ON wr.id = pr.routine_id
       WHERE pr.id = $1 AND pr.program_id = $2 AND p.user_id = $3`,
      [programRoutineId, programId, uid]
    );

    if (dayResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Program day not found' });
    }
    const day = dayResult.rows[0];
    if (!day.routine_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This day has no routine assigned' });
    }

    // Use existing routine start logic — get template exercises
    const templateResult = await client.query(
      `SELECT re.exercise_id, re.order_index, re.target_sets, re.target_reps_min, re.target_reps_max,
              re.target_weight, re.superset_group, re.notes, re.cooldown_seconds,
              re.overload_strategy, re.overload_increment, re.overload_schedule, re.overload_week_targets,
              re.tempo_eccentric, re.tempo_pause, re.tempo_concentric,
              re.target_rpe, re.micro_overload,
              e.name AS exercise_name, e.category, e.equipment_type,
              e.video_url_male, e.video_url_female
       FROM routine_exercises re
       JOIN exercises e ON re.exercise_id = e.id
       WHERE re.routine_id = $1 ORDER BY re.order_index`,
      [day.routine_id]
    );

    if (templateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Routine has no exercises' });
    }

    // Get last performance
    const lastWorkoutResult = await client.query(
      `SELECT w.id, w.workout_date, w.overall_notes FROM (SELECT * FROM workouts WHERE deleted_at IS NULL) w
       WHERE w.user_id = $1 AND w.routine_id = $2 AND w.workout_date <= $3
         AND w.status = 'completed'  -- an unfinished or cancelled session is never "last time"
       ORDER BY w.workout_date DESC, w.start_time DESC LIMIT 1`,
      [uid, day.routine_id, workout_date]
    );

    let lastWorkoutData = null;
    if (lastWorkoutResult.rows.length > 0) {
      const lastWorkout = lastWorkoutResult.rows[0];
      const lastExResult = await client.query(
        `SELECT we.exercise_id, we.exercise_notes,
                json_agg(json_build_object('set_number', ws.set_number, 'reps', ws.reps_completed, 'weight', ws.weight_used, 'rpe', ws.rpe) ORDER BY ws.set_number) AS sets_completed
         FROM workout_exercises we
         JOIN (SELECT * FROM workout_sets WHERE deleted_at IS NULL) ws ON we.id = ws.workout_exercise_id
         WHERE we.workout_id = $1
         GROUP BY we.id, we.exercise_id, we.exercise_notes`,
        [lastWorkout.id]
      );
      lastWorkoutData = { workout_date: lastWorkout.workout_date, overall_notes: lastWorkout.overall_notes, exercises: lastExResult.rows };
    }

    // Create workout with program context
    const workoutResult = await client.query(
      `INSERT INTO workouts (user_id, workout_date, routine_id, program_id, program_routine_id, start_time, status)
       VALUES ($1,$2,$3,$4,$5,NOW(),'in_progress') RETURNING *`,
      [uid, workout_date, day.routine_id, programId, programRoutineId]
    );

    const workout = workoutResult.rows[0];
    await recordSessionEvent(client, workout.id, 'started');
    const workoutExercises = [];

    for (const ex of templateResult.rows) {
      const lastPerf = lastWorkoutData?.exercises.find(le => le.exercise_id === ex.exercise_id);
      const exResult = await client.query(
        `INSERT INTO workout_exercises (workout_id, exercise_id, order_index, exercise_notes, target_sets, target_reps_min, target_reps_max, target_weight, target_rpe)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [workout.id, ex.exercise_id, ex.order_index, ex.notes, ex.target_sets || null, ex.target_reps_min || null, ex.target_reps_max || null, ex.target_weight || null,
         ex.target_rpe ?? null]
      );
      workoutExercises.push({
        ...exResult.rows[0],
        exercise_name: ex.exercise_name,
        category: ex.category,
        equipment_type: ex.equipment_type,
        video_url_male: ex.video_url_male,
        video_url_female: ex.video_url_female,
        template: { target_sets: ex.target_sets,
                    target_reps_min: ex.target_reps_min, target_reps_max: ex.target_reps_max,
                    target_weight: ex.target_weight, superset_group: ex.superset_group,
                    cooldown_seconds: ex.cooldown_seconds,
                    overload_strategy: ex.overload_strategy, overload_increment: ex.overload_increment,
                    overload_schedule: ex.overload_schedule, overload_week_targets: ex.overload_week_targets,
                    tempo_eccentric: ex.tempo_eccentric, tempo_pause: ex.tempo_pause,
                    tempo_concentric: ex.tempo_concentric,
                    target_rpe: ex.target_rpe ?? null, micro_overload: ex.micro_overload ?? null },
        last_performance: lastPerf || null,
      });
    }

    // Phase 1A-1: the routine's circuits are copied into the new workout.
    const circuits = await copyRoutineCircuits(client, day.routine_id, workout.id, uid);

    await client.query('COMMIT');
    res.status(201).json({
      workout,
      circuits,
      routine_name: day.routine_name,
      program_name: day.program_name,
      program_id: parseInt(programId),
      program_routine_id: parseInt(programRoutineId),
      exercises: workoutExercises,
      last_workout_date: lastWorkoutData?.workout_date || null,
      previous_overall_notes: lastWorkoutData?.overall_notes || null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('startProgramWorkout error:', err);
    res.status(500).json({ error: err.message || 'Failed to start program workout' });
  } finally {
    client.release();
  }
};

// Called when a program workout is finished — records program_workouts entry
const completeProgramWorkout = async (req, res) => {
  const uid = userId(req);
  const { programId, programRoutineId } = req.params;
  const { workout_id, completed_date, scheduled_date } = req.body;

  try {
    // Verify ownership
    const check = await pool.query(
      `SELECT id FROM programs WHERE id = $1 AND user_id = $2`, [programId, uid]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Program not found' });

    // Completion is recorded only for the user's own completed workout.
    const done = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND status = 'completed'`,
      [workout_id, uid]
    );
    if (done.rows.length === 0) {
      return res.status(409).json({ error: 'Only a completed workout can be recorded as program progress' });
    }

    const result = await pool.query(
      `INSERT INTO program_workouts (program_id, program_routine_id, workout_id, completed_date, scheduled_date)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING RETURNING *`,
      [programId, programRoutineId, workout_id, completed_date || null, scheduled_date || null]
    );

    res.json({ program_workout: result.rows[0] || null });
  } catch (err) {
    console.error('completeProgramWorkout error:', err);
    res.status(500).json({ error: 'Failed to record program workout' });
  }
};

// ── Progress ──────────────────────────────────────────────────────────────────

const getProgramProgress = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;

  try {
    const prog = await pool.query(
      `SELECT * FROM programs WHERE id = $1 AND user_id = $2`, [id, uid]
    );
    if (prog.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    const program = prog.rows[0];

    // Total workout days (non-rest)
    const totalDays = await pool.query(
      `SELECT COUNT(*) AS count FROM program_routines pr WHERE pr.program_id = $1 AND ${WORKOUT_DAY_SQL('pr')}`, [id]
    );

    // Completed workouts with target achievement data
    const completed = await pool.query(
      `SELECT pw.*, w.session_rating,
        ${durationSql('w')} AS duration_seconds,
        pr.week_number, pr.day_of_week
       FROM program_workouts pw
       JOIN (SELECT * FROM workouts WHERE deleted_at IS NULL) w ON w.id = pw.workout_id AND w.status = 'completed'
       JOIN program_routines pr ON pr.id = pw.program_routine_id
       WHERE pw.program_id = $1
       ORDER BY pw.completed_date`,
      [id]
    );

    // Avg target achievement per completed workout
    const achievement = await pool.query(
      `SELECT
        pw.workout_id,
        ROUND(AVG(
          CASE
            WHEN we.target_sets IS NULL THEN NULL
            ELSE LEAST(100.0, (COALESCE(qualifying.qualifying_count, 0)::NUMERIC / we.target_sets) * 100)
          END
        ), 1) AS target_achievement_pct
       FROM program_workouts pw
       JOIN (SELECT * FROM workouts WHERE deleted_at IS NULL) aw ON aw.id = pw.workout_id AND aw.status = 'completed'
       JOIN workout_exercises we ON we.workout_id = pw.workout_id
       LEFT JOIN (
         SELECT ws.workout_exercise_id, COUNT(*) AS qualifying_count
         FROM (SELECT * FROM workout_sets WHERE deleted_at IS NULL) ws
         JOIN workout_exercises we2 ON we2.id = ws.workout_exercise_id
         WHERE (we2.target_reps_min IS NULL OR ws.reps_completed >= we2.target_reps_min)
           AND (we2.target_weight IS NULL OR ws.weight_used >= we2.target_weight)
         GROUP BY ws.workout_exercise_id
       ) qualifying ON qualifying.workout_exercise_id = we.id
       WHERE pw.program_id = $1 AND we.target_sets IS NOT NULL
       GROUP BY pw.workout_id`,
      [id]
    );

    const achievementMap = {};
    achievement.rows.forEach(r => { achievementMap[r.workout_id] = r.target_achievement_pct; });

    const completedWithAchievement = completed.rows.map(r => ({
      ...r,
      target_achievement_pct: achievementMap[r.workout_id] || null,
    }));

    const totalDaysCount = parseInt(totalDays.rows[0].count);
    const completedCount = completed.rows.length;
    const pctComplete = totalDaysCount > 0 ? Math.round((completedCount / totalDaysCount) * 100) : 0;

    const avgAchievement = completedWithAchievement.filter(r => r.target_achievement_pct != null);
    const avgPct = avgAchievement.length
      ? Math.round(avgAchievement.reduce((s, r) => s + parseFloat(r.target_achievement_pct), 0) / avgAchievement.length)
      : null;

    // Phase 1A-1: skipped days are listed and counted separately. They are
    // never "completed", so pct_complete and completed_workouts ignore them.
    const skipped = await pool.query(
      `SELECT sk.id, sk.program_routine_id, sk.scheduled_date, sk.reason, sk.skipped_at,
              pr.week_number, pr.day_of_week
       FROM program_day_skips sk
       LEFT JOIN program_routines pr ON pr.id = sk.program_routine_id
       WHERE sk.program_id = $1
       ORDER BY sk.scheduled_date NULLS LAST, sk.id`,
      [id]
    );

    res.json({
      program,
      total_workout_days: totalDaysCount,
      completed_workouts: completedCount,
      pct_complete: pctComplete,
      avg_target_achievement_pct: avgPct,
      completed: completedWithAchievement,
      skipped_days: skipped.rows.length,
      skipped: skipped.rows,
    });
  } catch (err) {
    console.error('getProgramProgress error:', err);
    res.status(500).json({ error: 'Failed to get program progress' });
  }
};

// ── Active programs for workout hub ──────────────────────────────────────────

const getActivePrograms = async (req, res) => {
  const uid = userId(req);
  try {
    const result = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM program_routines tpr WHERE tpr.program_id = p.id AND ${WORKOUT_DAY_SQL('tpr')}) AS total_workout_days,
        (SELECT COUNT(*) FROM program_workouts cpw WHERE cpw.program_id = p.id AND ${pwDone('cpw')}) AS completed_workouts,
        -- Next incomplete day
        (SELECT row_to_json(next_day) FROM (
          SELECT pr.id AS program_routine_id, pr.week_number, pr.day_of_week, pr.order_index,
                 wr.id AS routine_id, wr.name AS routine_name
          FROM program_routines pr
          LEFT JOIN workout_routines wr ON wr.id = pr.routine_id
          LEFT JOIN program_workouts pw ON pw.program_routine_id = pr.id AND ${pwDone('pw')}
          WHERE pr.program_id = p.id AND ${WORKOUT_DAY_SQL('pr')} AND pw.id IS NULL
            AND NOT EXISTS (SELECT 1 FROM program_day_skips sk WHERE sk.program_routine_id = pr.id)
          ORDER BY pr.week_number, pr.order_index
          LIMIT 1
        ) next_day) AS next_day
       FROM programs p
       WHERE p.user_id = $1 AND p.status = 'active'
       ORDER BY p.updated_at DESC`,
      [uid]
    );
    res.json({ programs: result.rows });
  } catch (err) {
    console.error('getActivePrograms error:', err);
    res.status(500).json({ error: 'Failed to get active programs' });
  }
};

// ── Journal ───────────────────────────────────────────────────────────────────

const addJournalEntry = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });

  try {
    const check = await pool.query(`SELECT id FROM programs WHERE id = $1 AND user_id = $2`, [id, uid]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Program not found' });

    const result = await pool.query(
      `INSERT INTO program_journal_entries (program_id, user_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [id, uid, content.trim()]
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    console.error('addJournalEntry error:', err);
    res.status(500).json({ error: 'Failed to add journal entry' });
  }
};

const updateJournalEntry = async (req, res) => {
  const uid = userId(req);
  const { entryId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });

  try {
    const result = await pool.query(
      `UPDATE program_journal_entries SET content = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [content.trim(), entryId, uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry: result.rows[0] });
  } catch (err) {
    console.error('updateJournalEntry error:', err);
    res.status(500).json({ error: 'Failed to update journal entry' });
  }
};

const deleteJournalEntry = async (req, res) => {
  const uid = userId(req);
  const { entryId } = req.params;
  try {
    await pool.query(`DELETE FROM program_journal_entries WHERE id = $1 AND user_id = $2`, [entryId, uid]);
    res.json({ message: 'Entry deleted' });
  } catch (err) {
    console.error('deleteJournalEntry error:', err);
    res.status(500).json({ error: 'Failed to delete journal entry' });
  }
};

// ── Stats silo ────────────────────────────────────────────────────────────────

const getProgramStats = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;

  try {
    const check = await pool.query(`SELECT * FROM programs WHERE id = $1 AND user_id = $2`, [id, uid]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    const program = check.rows[0];

    // All workouts in this program with full data
    const workouts = await pool.query(
      `SELECT
        w.id, w.workout_date, w.start_time, w.end_time, w.session_rating,
        ${durationSql('w')} AS duration_seconds,
        COALESCE(w.workout_title, wr.name) AS title,
        pr.week_number, pr.day_of_week, pr.order_index,
        SUM(ws.reps_completed * ws.weight_used)::INTEGER AS volume,
        ROUND(AVG(ws.rpe)::NUMERIC, 1) AS avg_rpe,
        COUNT(DISTINCT we.id) AS exercise_count,
        COUNT(ws.id) AS total_sets
       FROM program_workouts pw
       JOIN workouts w ON w.id = pw.workout_id AND w.status = 'completed' AND w.deleted_at IS NULL
       LEFT JOIN workout_routines wr ON wr.id = w.routine_id
       LEFT JOIN program_routines pr ON pr.id = pw.program_routine_id
       LEFT JOIN workout_exercises we ON we.workout_id = w.id
       LEFT JOIN (SELECT * FROM workout_sets WHERE deleted_at IS NULL) ws ON ws.workout_exercise_id = we.id
       WHERE pw.program_id = $1
       GROUP BY w.id, wr.name, pr.week_number, pr.day_of_week, pr.order_index
       ORDER BY w.workout_date`,
      [id]
    );

    // Per-exercise progression across program
    const progression = await pool.query(
      `SELECT
        e.name AS exercise_name,
        w.workout_date,
        pr.week_number,
        MAX(ws.weight_used) AS max_weight,
        MAX(ws.reps_completed) AS max_reps,
        COUNT(ws.id) AS sets_logged,
        ROUND(AVG(ws.rpe)::NUMERIC, 1) AS avg_rpe
       FROM program_workouts pw
       JOIN (SELECT * FROM workouts WHERE deleted_at IS NULL) w ON w.id = pw.workout_id AND w.status = 'completed'
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN exercises e ON e.id = we.exercise_id
       JOIN (SELECT * FROM workout_sets WHERE deleted_at IS NULL) ws ON ws.workout_exercise_id = we.id
       LEFT JOIN program_routines pr ON pr.id = pw.program_routine_id
       WHERE pw.program_id = $1
       GROUP BY e.name, w.workout_date, pr.week_number
       ORDER BY e.name, w.workout_date`,
      [id]
    );

    res.json({
      program,
      workouts: workouts.rows,
      progression: progression.rows,
    });
  } catch (err) {
    console.error('getProgramStats error:', err);
    res.status(500).json({ error: 'Failed to get program stats' });
  }
};

// ══ Phase 1A-1: pin, schedule, phases, documents, skips, pause ══════════════

// PUT /programs/:id/pin  { pinned: true|false }
const pinProgram = async (req, res) => {
  try {
    const pinned = V.take(V.bool(req.body?.pinned, 'pinned'));
    if (pinned === null) throw V.badRequest('pinned must be true or false');
    const program = await ownProgram(pool, req.params.id, userId(req));
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json({ program: await applyProgramNewFields(pool, program.id, { is_pinned: pinned }) });
  } catch (err) { fail(res, err, 'pin program'); }
};

/** Phases in order, with start/end day (a NULL start follows the previous phase) and base dates. */
async function loadPhases(db, program) {
  const r = await db.query(
    `SELECT id, name, start_day, length_days, notes, order_index FROM program_phases
     WHERE program_id = $1 ORDER BY order_index, id`,
    [program.id]
  );
  let next = 1;
  const start = program.start_date ? dbDate(program.start_date) : null;
  return r.rows.map(ph => {
    const first = ph.start_day || next;
    const last = first + ph.length_days - 1;
    next = last + 1;
    return {
      ...ph,
      first_day: first,
      last_day: last,
      start_date: start ? addDays(start, first - 1) : null,
      end_date: start ? addDays(start, last - 1) : null,
    };
  });
}

// GET /programs/:id/phases
const getPhases = async (req, res) => {
  try {
    const program = await ownProgram(pool, req.params.id, userId(req));
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json({ phases: await loadPhases(pool, program) });
  } catch (err) { fail(res, err, 'get phases'); }
};

// PUT /programs/:id/phases  { phases: [{ name, length_days, start_day?, notes? }] } — replaces the list
const putPhases = async (req, res) => {
  const client = await pool.connect();
  try {
    const list = req.body?.phases;
    if (!Array.isArray(list)) throw V.badRequest('phases must be a list');
    if (list.length > 200) throw V.badRequest('At most 200 phases');
    const phases = list.map((ph, i) => {
      if (!ph || typeof ph !== 'object') throw V.badRequest(`phases[${i}] must be an object`);
      return {
        name: V.take(V.text(ph.name, `phases[${i}].name`, 200, { required: true })),
        start_day: V.take(V.intIn(ph.start_day, `phases[${i}].start_day`, 1, 3650)),
        length_days: V.take(V.intIn(ph.length_days, `phases[${i}].length_days`, 1, 3650, { required: true })),
        notes: V.take(V.text(ph.notes, `phases[${i}].notes`, 5000)),
      };
    });
    await client.query('BEGIN');
    const program = await ownProgram(client, req.params.id, userId(req));
    if (!program) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Program not found' }); }
    await client.query(`DELETE FROM program_phases WHERE program_id = $1`, [program.id]);
    for (const [i, ph] of phases.entries()) {
      await client.query(
        `INSERT INTO program_phases (program_id, name, start_day, length_days, notes, order_index) VALUES ($1,$2,$3,$4,$5,$6)`,
        [program.id, ph.name, ph.start_day, ph.length_days, ph.notes, i + 1]
      );
    }
    await client.query('COMMIT');
    res.json({ phases: await loadPhases(pool, program) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'save phases');
  } finally { client.release(); }
};

async function loadDocs(db, program) {
  const [legend, sources] = await Promise.all([
    db.query(`SELECT id, label, description, order_index FROM program_legend_items WHERE program_id = $1 ORDER BY order_index, id`, [program.id]),
    db.query(`SELECT id, title, url, note, order_index FROM program_sources WHERE program_id = $1 ORDER BY order_index, id`, [program.id]),
  ]);
  return { overview: program.overview || null, legend: legend.rows, sources: sources.rows };
}

// GET /programs/:id/docs
const getDocs = async (req, res) => {
  try {
    const program = await ownProgram(pool, req.params.id, userId(req));
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(await loadDocs(pool, program));
  } catch (err) { fail(res, err, 'get program documents'); }
};

// PUT /programs/:id/docs  { overview?, legend?: [{label, description?}], sources?: [{title, url?, note?}] }
// Each key sent replaces that part; keys left out are kept.
const putDocs = async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  try {
    const overview = 'overview' in body ? V.take(V.text(body.overview, 'overview', 20000)) : undefined;
    let legend; let sources;
    if ('legend' in body) {
      if (!Array.isArray(body.legend)) throw V.badRequest('legend must be a list');
      if (body.legend.length > 100) throw V.badRequest('At most 100 legend entries');
      legend = body.legend.map((l, i) => ({
        label: V.take(V.text(l?.label, `legend[${i}].label`, 100, { required: true })),
        description: V.take(V.text(l?.description, `legend[${i}].description`, 2000)),
      }));
    }
    if ('sources' in body) {
      if (!Array.isArray(body.sources)) throw V.badRequest('sources must be a list');
      if (body.sources.length > 100) throw V.badRequest('At most 100 sources');
      sources = body.sources.map((x, i) => ({
        title: V.take(V.text(x?.title, `sources[${i}].title`, 200, { required: true })),
        url: V.take(V.url(x?.url, `sources[${i}].url`)),
        note: V.take(V.text(x?.note, `sources[${i}].note`, 2000)),
      }));
    }
    await client.query('BEGIN');
    let program = await ownProgram(client, req.params.id, userId(req));
    if (!program) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Program not found' }); }
    if (overview !== undefined) program = await applyProgramNewFields(client, program.id, { overview });
    if (legend) {
      await client.query(`DELETE FROM program_legend_items WHERE program_id = $1`, [program.id]);
      for (const [i, l] of legend.entries()) {
        await client.query(`INSERT INTO program_legend_items (program_id, label, description, order_index) VALUES ($1,$2,$3,$4)`,
          [program.id, l.label, l.description, i + 1]);
      }
    }
    if (sources) {
      await client.query(`DELETE FROM program_sources WHERE program_id = $1`, [program.id]);
      for (const [i, x] of sources.entries()) {
        await client.query(`INSERT INTO program_sources (program_id, title, url, note, order_index) VALUES ($1,$2,$3,$4,$5)`,
          [program.id, x.title, x.url, x.note, i + 1]);
      }
    }
    await client.query('COMMIT');
    res.json(await loadDocs(pool, program));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'save program documents');
  } finally { client.release(); }
};

// GET /programs/:id/schedule — every item of one program with its date
const getProgramSchedule = async (req, res) => {
  try {
    const program = await ownProgram(pool, req.params.id, userId(req));
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const [items, phases, pauses] = await Promise.all([
      loadSchedule(pool, [program]),
      loadPhases(pool, program),
      pool.query(`SELECT * FROM program_pauses WHERE program_id = $1 ORDER BY from_date, id`, [program.id]),
    ]);
    res.json({
      program: {
        id: program.id, name: program.name, status: program.status, color: program.color,
        schedule_mode: program.schedule_mode, workouts_per_week: program.workouts_per_week,
        start_date: program.start_date ? dbDate(program.start_date) : null, duration_weeks: program.duration_weeks,
      },
      phases,
      pauses: pauses.rows,
      items,
    });
  } catch (err) { fail(res, err, 'get program schedule'); }
};

/** Items of the user's started programs (not drafts) between two dates (inclusive; either may be omitted). */
async function userScheduleItems(db, uid, from, to) {
  const progs = await db.query(
    `SELECT * FROM programs WHERE user_id = $1 AND start_date IS NOT NULL AND status <> 'draft' ORDER BY id`,
    [uid]
  );
  const items = await loadSchedule(db, progs.rows);
  return items.filter(it => {
    const a = it.date || it.week_start; const b = it.date || it.week_end;
    if (!a) return false;
    return (!from || b >= from) && (!to || a <= to);
  });
}

// GET /programs/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD — all programs, for a calendar
const getUserSchedule = async (req, res) => {
  try {
    const from = V.take(V.dateStr(req.query.from, 'from'));
    const to = V.take(V.dateStr(req.query.to, 'to'));
    if (from && to && to < from) throw V.badRequest('to must be on or after from');
    res.json({ from, to, items: await userScheduleItems(pool, userId(req), from, to) });
  } catch (err) { fail(res, err, 'get schedule'); }
};

/** The program day (program_routines row) if it belongs to the user's program. */
async function ownDay(db, programId, dayId, uid) {
  const p = Number(programId); const d = Number(dayId);
  if (![p, d].every(n => Number.isInteger(n) && n > 0 && n <= 2147483647)) return null;
  const r = await db.query(
    `SELECT pr.*, p.user_id FROM program_routines pr JOIN programs p ON p.id = pr.program_id
     WHERE pr.id = $1 AND pr.program_id = $2 AND p.user_id = $3`,
    [d, p, uid]
  );
  return r.rows[0] || null;
}

// POST /programs/:id/days/:programRoutineId/skip  { reason?, scheduled_date? }
// The day stays on the schedule; it is marked skipped (never completed).
const skipDay = async (req, res) => {
  const uid = userId(req);
  try {
    const reason = V.take(V.text(req.body?.reason, 'reason', 1000));
    let date = V.take(V.dateStr(req.body?.scheduled_date, 'scheduled_date'));
    const day = await ownDay(pool, req.params.id, req.params.programRoutineId, uid);
    if (!day) return res.status(404).json({ error: 'Program day not found' });
    if (effectiveDayType(day) === 'rest_day') return res.status(400).json({ error: 'A rest day cannot be skipped' });
    const done = await pool.query(
      `SELECT 1 FROM program_workouts pw WHERE pw.program_routine_id = $1 AND ${pwDone('pw')} LIMIT 1`, [day.id]
    );
    if (done.rows.length) return res.status(409).json({ error: 'This day is already completed' });
    if (!date) {
      const program = await ownProgram(pool, day.program_id, uid);
      const item = (await loadSchedule(pool, [program])).find(it => it.program_routine_id === day.id);
      date = item?.date || null;
    }
    const r = await pool.query(
      `INSERT INTO program_day_skips (program_id, program_routine_id, user_id, scheduled_date, reason)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (program_routine_id) WHERE program_routine_id IS NOT NULL
       DO UPDATE SET reason = EXCLUDED.reason, scheduled_date = COALESCE(EXCLUDED.scheduled_date, program_day_skips.scheduled_date)
       RETURNING *, (xmax = 0) AS inserted`,
      [day.program_id, day.id, uid, date, reason]
    );
    const { inserted, ...skip } = r.rows[0];
    res.status(inserted ? 201 : 200).json({ skip });
  } catch (err) { fail(res, err, 'skip day'); }
};

// DELETE /programs/:id/days/:programRoutineId/skip — undo a skip
const unskipDay = async (req, res) => {
  try {
    const day = await ownDay(pool, req.params.id, req.params.programRoutineId, userId(req));
    if (!day) return res.status(404).json({ error: 'Program day not found' });
    const r = await pool.query(`DELETE FROM program_day_skips WHERE program_routine_id = $1 RETURNING id`, [day.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'This day is not skipped' });
    res.json({ message: 'Skip removed' });
  } catch (err) { fail(res, err, 'remove skip'); }
};

// POST /programs/:id/pause  { delay_days, from_date?, reason? }
// Owner decision: status becomes 'paused' until resumed; items dated on or
// after from_date (default: the user's today) move delay_days later.
const pauseProgram = async (req, res) => {
  const uid = userId(req);
  const client = await pool.connect();
  try {
    const delay = V.take(V.intIn(req.body?.delay_days, 'delay_days', 0, 365, { required: true }));
    let from = V.take(V.dateStr(req.body?.from_date, 'from_date'));
    const reason = V.take(V.text(req.body?.reason, 'reason', 1000));
    await client.query('BEGIN');
    const program = await ownProgram(client, req.params.id, uid);
    if (!program) throw httpError(404, 'Program not found');
    if (program.status !== 'active') throw httpError(409, 'Only an active program can be paused');
    const open = await client.query(`SELECT id FROM program_pauses WHERE program_id = $1 AND resumed_at IS NULL`, [program.id]);
    if (open.rows.length) throw httpError(409, 'This program is already paused');
    if (!from) {
      const tz = await client.query(`SELECT timezone FROM users WHERE id = $1`, [uid]);
      from = todayIn(tz.rows[0]?.timezone);
    }
    const pause = await client.query(
      `INSERT INTO program_pauses (program_id, user_id, from_date, delay_days, reason, previous_status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [program.id, uid, from, delay, reason, program.status]
    );
    const updated = await client.query(
      `UPDATE programs SET status = 'paused', updated_at = NOW() WHERE id = $1 RETURNING *`, [program.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ pause: pause.rows[0], program: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'pause program');
  } finally { client.release(); }
};

// POST /programs/:id/resume  { delay_days? } — ends the open pause; delay_days can be corrected
const resumeProgram = async (req, res) => {
  const uid = userId(req);
  const client = await pool.connect();
  try {
    const delay = V.take(V.intIn(req.body?.delay_days, 'delay_days', 0, 365));
    await client.query('BEGIN');
    const program = await ownProgram(client, req.params.id, uid);
    if (!program) throw httpError(404, 'Program not found');
    const open = await client.query(
      `SELECT * FROM program_pauses WHERE program_id = $1 AND resumed_at IS NULL ORDER BY id DESC LIMIT 1`, [program.id]
    );
    if (!open.rows.length) throw httpError(409, 'This program is not paused');
    const pause = await client.query(
      `UPDATE program_pauses SET resumed_at = NOW(), delay_days = COALESCE($1, delay_days) WHERE id = $2 RETURNING *`,
      [delay, open.rows[0].id]
    );
    const updated = await client.query(
      `UPDATE programs SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [program.status === 'paused' ? (open.rows[0].previous_status || 'active') : program.status, program.id]
    );
    await client.query('COMMIT');
    res.json({ pause: pause.rows[0], program: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'resume program');
  } finally { client.release(); }
};

// GET /programs/:id/pauses
const getPauses = async (req, res) => {
  try {
    const program = await ownProgram(pool, req.params.id, userId(req));
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const r = await pool.query(`SELECT * FROM program_pauses WHERE program_id = $1 ORDER BY from_date, id`, [program.id]);
    res.json({ pauses: r.rows });
  } catch (err) { fail(res, err, 'get pauses'); }
};

module.exports = {
  userScheduleItems,
  pinProgram, getPhases, putPhases, getDocs, putDocs, getProgramSchedule, getUserSchedule,
  skipDay, unskipDay, pauseProgram, resumeProgram, getPauses,
  createProgram,
  getPrograms,
  getProgramById,
  updateProgram,
  deleteProgram,
  activateProgram,
  startProgramWorkout,
  completeProgramWorkout,
  getProgramProgress,
  getActivePrograms,
  addJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getProgramStats,
};
