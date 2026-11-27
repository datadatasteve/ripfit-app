// backend/src/controllers/habitController.js
// Habits, habit logs and program goals (Phase 1A-2).
//
// - A habit has a target, a unit and a frequency (daily, weekly or specific
//   weekdays). It can link to a program, a routine or a cardio type.
// - auto_metric habits are computed from logged data on every read
//   (completed, not deleted workouts; cardio segments; cardio sessions), so
//   they always match the history. Other habits are logged by hand.
// - Starter habits ("Workouts per week", "Training minutes per day") are
//   created for each user on first read. While the settings goal they follow
//   (users.goals, type 'consistency') has a value, that value is the target.
// - Create/update return `warnings` (advisory only, never blocking).
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { durationSql } = require('../utils/workoutStatus');
const { todayIn, addDays, weekdayMon0, dbDate } = require('../utils/programSchedule');
const { habitWarnings, goalWarnings } = require('../utils/habitWarnings');

const FREQUENCIES = ['daily', 'weekly', 'specific_days'];
const AUTO_METRICS = ['workouts_completed', 'workout_minutes', 'cardio_minutes', 'cardio_distance'];

const STARTERS = [
  { key: 'workouts_per_week', name: 'Workouts per week', unit: 'workouts', frequency: 'weekly',
    auto_metric: 'workouts_completed', goal_link: 'consistency.sessions_per_week', fallback: 3 },
  { key: 'minutes_per_day', name: 'Training minutes per day', unit: 'minutes', frequency: 'daily',
    auto_metric: 'workout_minutes', goal_link: 'consistency.minutes_per_day', fallback: 30 },
];

function fail(res, err, what) {
  if (err.statusCode === 400) return res.status(400).json({ error: err.message });
  if (err.statusCode === 404) return res.status(404).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const notFound = what => Object.assign(new Error(`${what} not found`), { statusCode: 404 });
const idOf = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

/** The value a settings goal gives for a goal_link like 'consistency.sessions_per_week', or null. */
function goalValue(goals, link) {
  if (!link || !Array.isArray(goals)) return null;
  const [type, field] = link.split('.');
  const g = goals.find(x => x && x.type === type);
  const v = g?.details?.[field];
  const n = v === '' || v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function userInfo(db, uid) {
  const r = await db.query(`SELECT timezone, goals FROM users WHERE id = $1`, [uid]);
  return r.rows[0] || { timezone: null, goals: [] };
}

/** Creates the starter habits once per user (active when the settings goal is set). */
async function ensureStarters(db, uid, goals) {
  for (const s of STARTERS) {
    const gv = goalValue(goals, s.goal_link);
    await db.query(
      `INSERT INTO habits (user_id, name, target_value, unit, frequency, auto_metric, goal_link, starter_key, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, starter_key) WHERE starter_key IS NOT NULL DO NOTHING`,
      [uid, s.name, gv ?? s.fallback, s.unit, s.frequency, s.auto_metric, s.goal_link, s.key, gv !== null]
    );
  }
}

/** The current period of a habit in the user's calendar. */
function periodOf(habit, today) {
  if (habit.frequency === 'weekly') {
    const start = addDays(today, -weekdayMon0(today));
    return { start, end: addDays(start, 6) };
  }
  return { start: today, end: today };
}

/** The auto metric's value for a habit over [from, to] (inclusive, user-local dates). */
async function autoValue(db, uid, habit, from, to) {
  const params = [uid, from, to];
  const wf = [];
  if (habit.program_id) { params.push(habit.program_id); wf.push(`w.program_id = $${params.length}`); }
  if (habit.routine_id) { params.push(habit.routine_id); wf.push(`w.routine_id = $${params.length}`); }
  const extra = wf.length ? `AND ${wf.join(' AND ')}` : '';
  const liveWorkouts = `w.user_id = $1 AND w.status = 'completed' AND w.deleted_at IS NULL AND w.workout_date BETWEEN $2 AND $3 ${extra}`;
  let typeSql = ''; let sessTypeSql = '';
  if (habit.cardio_type) {
    params.push(habit.cardio_type);
    typeSql = `AND LOWER(e.name) = LOWER($${params.length})`;
    sessTypeSql = `AND LOWER(cs.cardio_type) = LOWER($${params.length})`;
  }
  const num = r => Number(r.rows[0].v) || 0;
  switch (habit.auto_metric) {
    case 'workouts_completed': {
      const cardioFilter = habit.cardio_type
        ? `AND EXISTS (SELECT 1 FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id WHERE we.workout_id = w.id ${typeSql})`
        : '';
      return num(await db.query(`SELECT COUNT(*) AS v FROM workouts w WHERE ${liveWorkouts} ${cardioFilter}`, params));
    }
    case 'workout_minutes':
      return Math.round(num(await db.query(`SELECT COALESCE(SUM(${durationSql('w')}), 0) / 60.0 AS v FROM workouts w WHERE ${liveWorkouts}`, params)) * 10) / 10;
    case 'cardio_minutes':
    case 'cardio_distance': {
      const col = habit.auto_metric === 'cardio_minutes' ? 'duration_seconds' : 'distance';
      const seg = await db.query(
        `SELECT COALESCE(SUM(wcs.${col}), 0) AS v
         FROM workout_cardio_segments wcs
         JOIN workouts w ON w.id = wcs.workout_id
         JOIN workout_exercises we ON we.id = wcs.workout_exercise_id
         JOIN exercises e ON e.id = we.exercise_id
         WHERE ${liveWorkouts} AND wcs.deleted_at IS NULL ${typeSql}`,
        params
      );
      // Legacy Quick Cardio sessions (cardio_sessions) count too; they have no program or routine.
      let sess = { rows: [{ v: 0 }] };
      if (!habit.program_id && !habit.routine_id) {
        sess = await db.query(
          `SELECT COALESCE(SUM(cs.${col}), 0) AS v FROM cardio_sessions cs
           WHERE cs.user_id = $1 AND cs.status = 'completed' AND cs.session_date BETWEEN $2 AND $3 ${sessTypeSql}`,
          // No program or routine filter here, so the cardio type (if any) is $4, as in sessTypeSql.
          [uid, from, to, ...(habit.cardio_type ? [habit.cardio_type] : [])]
        );
      }
      const total = num(seg) + num(sess);
      return habit.auto_metric === 'cardio_minutes' ? Math.round((total / 60) * 10) / 10 : Math.round(total * 100) / 100;
    }
    default:
      return 0;
  }
}

/** Adds effective_target, progress and warnings to a habit row. */
async function decorate(db, uid, habit, info) {
  const today = todayIn(info.timezone);
  const gv = goalValue(info.goals, habit.goal_link);
  const target = gv ?? (habit.target_value === null ? null : Number(habit.target_value));
  const { start, end } = periodOf(habit, today);
  let value;
  if (habit.auto_metric) {
    value = await autoValue(db, uid, habit, start, end);
  } else {
    const r = await db.query(
      `SELECT COALESCE(SUM(value), 0) AS v FROM habit_logs WHERE habit_id = $1 AND log_date BETWEEN $2 AND $3`,
      [habit.id, start, end]
    );
    value = Number(r.rows[0].v) || 0;
  }
  const scheduledToday = habit.frequency !== 'specific_days' || (habit.days_of_week || []).includes(weekdayMon0(today));
  return {
    ...habit,
    target_value: habit.target_value === null ? null : Number(habit.target_value),
    effective_target: target,
    target_source: gv !== null ? 'settings_goal' : 'habit',
    progress: {
      period_start: start, period_end: end, value, target,
      met: target !== null ? value >= target : null,
      scheduled_today: scheduledToday,
      source: habit.auto_metric ? 'auto' : 'logs',
    },
    warnings: habitWarnings({ ...habit, target_value: target }),
  };
}

async function ownHabit(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT * FROM habits WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0] || null;
}

/** Validated habit fields (only keys present when updating). */
async function habitFields(db, body, uid, { creating }) {
  const out = {};
  const has = k => creating || k in body;
  if (has('name')) out.name = V.take(V.text(body.name, 'name', 100, { required: true }));
  if ('description' in body) out.description = V.take(V.text(body.description, 'description', 1000));
  if ('target_value' in body) out.target_value = V.take(V.numMin(body.target_value, 'target_value', 0, { max: 1000000 }));
  if ('unit' in body) out.unit = V.take(V.text(body.unit, 'unit', 20));
  if (has('frequency')) out.frequency = V.take(V.oneOf(body.frequency ?? 'daily', 'frequency', FREQUENCIES, { required: true }));
  if ('days_of_week' in body) {
    const d = body.days_of_week;
    if (d === null) out.days_of_week = null;
    else {
      if (!Array.isArray(d) || d.some(x => !Number.isInteger(x) || x < 0 || x > 6) || new Set(d).size !== d.length) {
        throw V.badRequest('days_of_week must be a list of different whole numbers from 0 (Monday) to 6 (Sunday)');
      }
      out.days_of_week = [...d].sort();
    }
  }
  if ('auto_metric' in body) out.auto_metric = V.take(V.oneOf(body.auto_metric, 'auto_metric', AUTO_METRICS));
  if ('cardio_type' in body) out.cardio_type = V.take(V.text(body.cardio_type, 'cardio_type', 50));
  if ('is_active' in body) {
    const a = V.take(V.bool(body.is_active, 'is_active'));
    if (a !== null) out.is_active = a;
  }
  if ('program_id' in body) {
    out.program_id = V.take(V.intIn(body.program_id, 'program_id', 1, 2147483647));
    if (out.program_id) {
      const r = await db.query(`SELECT 1 FROM programs WHERE id = $1 AND user_id = $2`, [out.program_id, uid]);
      if (!r.rows.length) throw V.badRequest('program_id is not one of your programs');
    }
  }
  if ('routine_id' in body) {
    out.routine_id = V.take(V.intIn(body.routine_id, 'routine_id', 1, 2147483647));
    if (out.routine_id) {
      const r = await db.query(`SELECT 1 FROM workout_routines WHERE id = $1 AND user_id = $2`, [out.routine_id, uid]);
      if (!r.rows.length) throw V.badRequest('routine_id is not one of your routines');
    }
  }
  return out;
}

function checkSpecificDays(row) {
  if (row.frequency === 'specific_days' && !(row.days_of_week || []).length) {
    throw V.badRequest('A specific_days habit needs days_of_week (0 = Monday … 6 = Sunday)');
  }
}

// GET /habits?include_inactive=true
const listHabits = async (req, res) => {
  const uid = req.user.userId;
  try {
    const info = await userInfo(pool, uid);
    await ensureStarters(pool, uid, info.goals);
    const all = req.query.include_inactive === 'true';
    const r = await pool.query(
      `SELECT * FROM habits WHERE user_id = $1 ${all ? '' : 'AND is_active'} ORDER BY starter_key IS NULL, id`, [uid]
    );
    const habits = [];
    for (const h of r.rows) habits.push(await decorate(pool, uid, h, info));
    res.json({ habits });
  } catch (err) { fail(res, err, 'list habits'); }
};

// GET /habits/:id
const getHabit = async (req, res) => {
  const uid = req.user.userId;
  try {
    const h = await ownHabit(pool, req.params.id, uid);
    if (!h) throw notFound('Habit');
    res.json({ habit: await decorate(pool, uid, h, await userInfo(pool, uid)) });
  } catch (err) { fail(res, err, 'get habit'); }
};

// POST /habits
const createHabit = async (req, res) => {
  const uid = req.user.userId;
  try {
    const f = await habitFields(pool, req.body || {}, uid, { creating: true });
    checkSpecificDays(f);
    const cols = Object.keys(f);
    const r = await pool.query(
      `INSERT INTO habits (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
      [uid, ...Object.values(f)]
    );
    const habit = await decorate(pool, uid, r.rows[0], await userInfo(pool, uid));
    res.status(201).json({ habit, warnings: habit.warnings });
  } catch (err) { fail(res, err, 'create habit'); }
};

// PUT /habits/:id
const updateHabit = async (req, res) => {
  const uid = req.user.userId;
  try {
    const cur = await ownHabit(pool, req.params.id, uid);
    if (!cur) throw notFound('Habit');
    const f = await habitFields(pool, req.body || {}, uid, { creating: false });
    checkSpecificDays({ ...cur, ...f });
    const keys = Object.keys(f);
    let row = cur;
    if (keys.length) {
      const r = await pool.query(
        `UPDATE habits SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW()
         WHERE id = $${keys.length + 1} RETURNING *`,
        [...Object.values(f), cur.id]
      );
      row = r.rows[0];
    }
    const habit = await decorate(pool, uid, row, await userInfo(pool, uid));
    res.json({ habit, warnings: habit.warnings });
  } catch (err) { fail(res, err, 'update habit'); }
};

// DELETE /habits/:id
const deleteHabit = async (req, res) => {
  try {
    const h = await ownHabit(pool, req.params.id, req.user.userId);
    if (!h) throw notFound('Habit');
    await pool.query(`DELETE FROM habits WHERE id = $1`, [h.id]);
    res.json({ message: 'Habit deleted' });
  } catch (err) { fail(res, err, 'delete habit'); }
};

// GET /habits/:id/logs?from=&to=
const listLogs = async (req, res) => {
  try {
    const from = V.take(V.dateStr(req.query.from, 'from'));
    const to = V.take(V.dateStr(req.query.to, 'to'));
    const h = await ownHabit(pool, req.params.id, req.user.userId);
    if (!h) throw notFound('Habit');
    const r = await pool.query(
      `SELECT id, to_char(log_date, 'YYYY-MM-DD') AS log_date, value::float AS value, note, created_at, updated_at
       FROM habit_logs WHERE habit_id = $1 AND ($2::date IS NULL OR log_date >= $2) AND ($3::date IS NULL OR log_date <= $3)
       ORDER BY log_date`,
      [h.id, from, to]
    );
    res.json({ logs: r.rows });
  } catch (err) { fail(res, err, 'list habit logs'); }
};

// PUT /habits/:id/logs/:date  { value?, note? } — one value per day (upsert)
const putLog = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const value = V.take(V.numMin(req.body?.value ?? 1, 'value', 0, { max: 1000000 }));
    const note = V.take(V.text(req.body?.note, 'note', 1000));
    const h = await ownHabit(pool, req.params.id, req.user.userId);
    if (!h) throw notFound('Habit');
    const r = await pool.query(
      `INSERT INTO habit_logs (habit_id, user_id, log_date, value, note) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (habit_id, log_date) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note, updated_at = NOW()
       RETURNING id, to_char(log_date, 'YYYY-MM-DD') AS log_date, value::float AS value, note`,
      [h.id, req.user.userId, date, value, note]
    );
    res.json({ log: r.rows[0], ...(h.auto_metric ? { note: 'This habit updates automatically; logged values are kept but not used for its progress.' } : {}) });
  } catch (err) { fail(res, err, 'save habit log'); }
};

// DELETE /habits/:id/logs/:date
const deleteLog = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const h = await ownHabit(pool, req.params.id, req.user.userId);
    if (!h) throw notFound('Habit');
    const r = await pool.query(`DELETE FROM habit_logs WHERE habit_id = $1 AND log_date = $2 RETURNING id`, [h.id, date]);
    if (!r.rows.length) throw notFound('Log');
    res.json({ message: 'Log deleted' });
  } catch (err) { fail(res, err, 'delete habit log'); }
};

// ── Program goals ─────────────────────────────────────────────────────────────

async function ownProgramId(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT id FROM programs WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0]?.id || null;
}

function goalFields(body, { creating }) {
  const out = {};
  if (creating || 'name' in body) out.name = V.take(V.text(body.name, 'name', 100, { required: true }));
  if ('metric' in body) out.metric = V.take(V.text(body.metric, 'metric', 50));
  if ('target_value' in body) out.target_value = V.take(V.numMin(body.target_value, 'target_value', 0, { max: 1000000 }));
  if ('threshold_value' in body) out.threshold_value = V.take(V.numMin(body.threshold_value, 'threshold_value', 0, { max: 1000000 }));
  if ('unit' in body) out.unit = V.take(V.text(body.unit, 'unit', 20));
  if ('notes' in body) out.notes = V.take(V.text(body.notes, 'notes', 2000));
  return out;
}
const goalOut = g => ({
  ...g,
  target_value: g.target_value === null ? null : Number(g.target_value),
  threshold_value: g.threshold_value === null ? null : Number(g.threshold_value),
});

// GET /programs/:id/goals
const listProgramGoals = async (req, res) => {
  try {
    const pid = await ownProgramId(pool, req.params.id, req.user.userId);
    if (!pid) throw notFound('Program');
    const r = await pool.query(`SELECT * FROM program_goals WHERE program_id = $1 ORDER BY id`, [pid]);
    res.json({ goals: r.rows.map(g => ({ ...goalOut(g), warnings: goalWarnings(g) })) });
  } catch (err) { fail(res, err, 'list program goals'); }
};

// POST /programs/:id/goals  { name, metric?, target_value?, threshold_value?, unit?, notes? }
const createProgramGoal = async (req, res) => {
  const uid = req.user.userId;
  try {
    const f = goalFields(req.body || {}, { creating: true });
    const pid = await ownProgramId(pool, req.params.id, uid);
    if (!pid) throw notFound('Program');
    const cols = Object.keys(f);
    const r = await pool.query(
      `INSERT INTO program_goals (program_id, user_id, ${cols.join(', ')})
       VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`,
      [pid, uid, ...Object.values(f)]
    );
    const warnings = goalWarnings(r.rows[0]);
    res.status(201).json({ goal: goalOut(r.rows[0]), warnings });
  } catch (err) { fail(res, err, 'create program goal'); }
};

// PUT /programs/:id/goals/:goalId
const updateProgramGoal = async (req, res) => {
  const uid = req.user.userId;
  try {
    const f = goalFields(req.body || {}, { creating: false });
    const pid = await ownProgramId(pool, req.params.id, uid);
    const gid = idOf(req.params.goalId);
    if (!pid || !gid) throw notFound('Goal');
    const keys = Object.keys(f);
    const r = await pool.query(
      `UPDATE program_goals SET ${[...keys.map((k, i) => `${k} = $${i + 1}`), 'updated_at = NOW()'].join(', ')}
       WHERE id = $${keys.length + 1} AND program_id = $${keys.length + 2} RETURNING *`,
      [...Object.values(f), gid, pid]
    );
    if (!r.rows.length) throw notFound('Goal');
    res.json({ goal: goalOut(r.rows[0]), warnings: goalWarnings(r.rows[0]) });
  } catch (err) { fail(res, err, 'update program goal'); }
};

// DELETE /programs/:id/goals/:goalId
const deleteProgramGoal = async (req, res) => {
  try {
    const pid = await ownProgramId(pool, req.params.id, req.user.userId);
    const gid = idOf(req.params.goalId);
    if (!pid || !gid) throw notFound('Goal');
    const r = await pool.query(`DELETE FROM program_goals WHERE id = $1 AND program_id = $2 RETURNING id`, [gid, pid]);
    if (!r.rows.length) throw notFound('Goal');
    res.json({ message: 'Goal deleted' });
  } catch (err) { fail(res, err, 'delete program goal'); }
};

module.exports = {
  listHabits, getHabit, createHabit, updateHabit, deleteHabit, listLogs, putLog, deleteLog,
  listProgramGoals, createProgramGoal, updateProgramGoal, deleteProgramGoal,
  // shared with reviews
  userInfo, ensureStarters, decorate, dbDate,
};
