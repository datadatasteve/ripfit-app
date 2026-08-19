// backend/src/controllers/programController.js
const { pool } = require('../config/database');

// ── Helpers ───────────────────────────────────────────────────────────────────

function userId(req) { return req.user.userId; }

// ── Programs CRUD ─────────────────────────────────────────────────────────────

const createProgram = async (req, res) => {
  const { name, description, synopsis, duration_weeks, start_date, schedule_shift_pref, days } = req.body;
  const uid = userId(req);
  if (!name) return res.status(400).json({ error: 'name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prog = await client.query(
      `INSERT INTO programs (user_id, name, description, synopsis, duration_weeks, start_date, status, schedule_shift_pref)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *`,
      [uid, name, description || null, synopsis || null, duration_weeks || null,
       start_date || null, schedule_shift_pref || 'none']
    );

    const program = prog.rows[0];

    // Insert program days if provided
    if (Array.isArray(days) && days.length > 0) {
      for (const day of days) {
        await client.query(
          `INSERT INTO program_routines (program_id, routine_id, week_number, day_of_week, order_index, is_rest_day, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [program.id, day.routine_id || null, day.week_number || 1,
           day.day_of_week ?? null, day.order_index || 1,
           day.is_rest_day || false, day.notes || null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ program });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createProgram error:', err);
    res.status(500).json({ error: 'Failed to create program' });
  } finally {
    client.release();
  }
};

const getPrograms = async (req, res) => {
  const uid = userId(req);
  try {
    const result = await pool.query(
      `SELECT p.*,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.is_rest_day = FALSE) AS total_workout_days,
        COUNT(DISTINCT pw.id) AS completed_workouts
       FROM programs p
       LEFT JOIN program_routines pr ON pr.program_id = p.id
       LEFT JOIN program_workouts pw ON pw.program_id = p.id
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
        COUNT(DISTINCT pr.id) FILTER (WHERE NOT pr.is_rest_day) AS total_workout_days,
        COUNT(DISTINCT pw.id) AS completed_workouts
       FROM programs p
       LEFT JOIN program_routines pr ON pr.program_id = p.id
       LEFT JOIN program_workouts pw ON pw.program_id = p.id
       WHERE p.id = $1 AND p.user_id = $2
       GROUP BY p.id`,
      [id, uid]
    );
    if (progResult.rows.length === 0) return res.status(404).json({ error: 'Program not found' });

    const program = progResult.rows[0];

    // Get days with routine info
    const daysResult = await pool.query(
      `SELECT pr.*, wr.name AS routine_name, wr.description AS routine_description,
        COUNT(re.id) AS exercise_count,
        pw.completed_date, pw.workout_id AS completed_workout_id
       FROM program_routines pr
       LEFT JOIN workout_routines wr ON wr.id = pr.routine_id
       LEFT JOIN routine_exercises re ON re.routine_id = wr.id
       LEFT JOIN program_workouts pw ON pw.program_routine_id = pr.id
       WHERE pr.program_id = $1
       GROUP BY pr.id, wr.name, wr.description, pw.completed_date, pw.workout_id
       ORDER BY pr.week_number, pr.day_of_week, pr.order_index`,
      [id]
    );

    // Get journal entries
    const journalResult = await pool.query(
      `SELECT * FROM program_journal_entries WHERE program_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    res.json({ ...program, days: daysResult.rows, journal: journalResult.rows });
  } catch (err) {
    console.error('getProgramById error:', err);
    res.status(500).json({ error: 'Failed to get program' });
  }
};

const updateProgram = async (req, res) => {
  const uid = userId(req);
  const { id } = req.params;
  const { name, description, synopsis, duration_weeks, start_date, status, schedule_shift_pref, days } = req.body;

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
        updated_at = NOW()
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [name, description, synopsis, duration_weeks, start_date, status, schedule_shift_pref, id, uid]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Program not found' });
    }

    // Replace days if provided
    if (Array.isArray(days)) {
      await client.query(`DELETE FROM program_routines WHERE program_id = $1`, [id]);
      for (const day of days) {
        await client.query(
          `INSERT INTO program_routines (program_id, routine_id, week_number, day_of_week, order_index, is_rest_day, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, day.routine_id || null, day.week_number || 1,
           day.day_of_week ?? null, day.order_index || 1,
           day.is_rest_day || false, day.notes || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ program: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateProgram error:', err);
    res.status(500).json({ error: 'Failed to update program' });
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

    if (dayResult.rows.length === 0) return res.status(404).json({ error: 'Program day not found' });
    const day = dayResult.rows[0];
    if (!day.routine_id) return res.status(400).json({ error: 'This day has no routine assigned' });

    // Use existing routine start logic — get template exercises
    const templateResult = await client.query(
      `SELECT re.exercise_id, re.order_index, re.target_sets, re.target_reps,
              re.target_weight, re.superset_group, re.notes,
              e.name AS exercise_name, e.category, e.equipment_type
       FROM routine_exercises re
       JOIN exercises e ON re.exercise_id = e.id
       WHERE re.routine_id = $1 ORDER BY re.order_index`,
      [day.routine_id]
    );

    if (templateResult.rows.length === 0) return res.status(400).json({ error: 'Routine has no exercises' });

    // Get last performance
    const lastWorkoutResult = await client.query(
      `SELECT w.id, w.workout_date, w.overall_notes FROM workouts w
       WHERE w.user_id = $1 AND w.routine_id = $2 AND w.workout_date <= $3
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
         JOIN workout_sets ws ON we.id = ws.workout_exercise_id
         WHERE we.workout_id = $1
         GROUP BY we.id, we.exercise_id, we.exercise_notes`,
        [lastWorkout.id]
      );
      lastWorkoutData = { workout_date: lastWorkout.workout_date, overall_notes: lastWorkout.overall_notes, exercises: lastExResult.rows };
    }

    // Create workout with program context
    const workoutResult = await client.query(
      `INSERT INTO workouts (user_id, workout_date, routine_id, program_id, program_routine_id, start_time)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [uid, workout_date, day.routine_id, programId, programRoutineId]
    );

    const workout = workoutResult.rows[0];
    const workoutExercises = [];

    for (const ex of templateResult.rows) {
      const lastPerf = lastWorkoutData?.exercises.find(le => le.exercise_id === ex.exercise_id);
      const exResult = await client.query(
        `INSERT INTO workout_exercises (workout_id, exercise_id, order_index, exercise_notes, target_sets, target_reps, target_weight)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [workout.id, ex.exercise_id, ex.order_index, ex.notes, ex.target_sets || null, ex.target_reps || null, ex.target_weight || null]
      );
      workoutExercises.push({
        ...exResult.rows[0],
        exercise_name: ex.exercise_name,
        category: ex.category,
        equipment_type: ex.equipment_type,
        template: { target_sets: ex.target_sets, target_reps: ex.target_reps, target_weight: ex.target_weight },
        last_performance: lastPerf || null,
      });
    }

    await client.query('COMMIT');
    res.status(201).json({
      workout,
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
      `SELECT COUNT(*) AS count FROM program_routines WHERE program_id = $1 AND NOT is_rest_day`, [id]
    );

    // Completed workouts with target achievement data
    const completed = await pool.query(
      `SELECT pw.*, w.session_rating,
        EXTRACT(EPOCH FROM (w.end_time - w.start_time))::INTEGER AS duration_seconds,
        pr.week_number, pr.day_of_week
       FROM program_workouts pw
       JOIN workouts w ON w.id = pw.workout_id
       JOIN program_routines pr ON pr.id = pw.program_routine_id
       WHERE pw.program_id = $1
       ORDER BY pw.completed_date`,
      [id]
    );

    // Avg target achievement per completed workout
    const achievement = await pool.query(
      `SELECT
        pw.workout_id,
        ROUND(AVG(CASE
          WHEN we.target_sets IS NOT NULL AND ws_agg.set_count >= we.target_sets THEN 100.0
          WHEN we.target_sets IS NOT NULL THEN ws_agg.set_count::NUMERIC / we.target_sets * 100
          ELSE NULL
        END), 1) AS target_achievement_pct
       FROM program_workouts pw
       JOIN workout_exercises we ON we.workout_id = pw.workout_id
       LEFT JOIN (
         SELECT workout_exercise_id, COUNT(*) AS set_count FROM workout_sets GROUP BY workout_exercise_id
       ) ws_agg ON ws_agg.workout_exercise_id = we.id
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

    res.json({
      program,
      total_workout_days: totalDaysCount,
      completed_workouts: completedCount,
      pct_complete: pctComplete,
      avg_target_achievement_pct: avgPct,
      completed: completedWithAchievement,
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
        (SELECT COUNT(*) FROM program_routines WHERE program_id = p.id AND NOT is_rest_day) AS total_workout_days,
        (SELECT COUNT(*) FROM program_workouts WHERE program_id = p.id) AS completed_workouts,
        -- Next incomplete day
        (SELECT row_to_json(next_day) FROM (
          SELECT pr.id AS program_routine_id, pr.week_number, pr.day_of_week, pr.order_index,
                 wr.id AS routine_id, wr.name AS routine_name
          FROM program_routines pr
          LEFT JOIN workout_routines wr ON wr.id = pr.routine_id
          LEFT JOIN program_workouts pw ON pw.program_routine_id = pr.id
          WHERE pr.program_id = p.id AND NOT pr.is_rest_day AND pw.id IS NULL
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
        EXTRACT(EPOCH FROM (w.end_time - w.start_time))::INTEGER AS duration_seconds,
        COALESCE(w.workout_title, wr.name) AS title,
        pr.week_number, pr.day_of_week, pr.order_index,
        SUM(ws.reps_completed * ws.weight_used)::INTEGER AS volume,
        ROUND(AVG(ws.rpe)::NUMERIC, 1) AS avg_rpe,
        COUNT(DISTINCT we.id) AS exercise_count,
        COUNT(ws.id) AS total_sets
       FROM program_workouts pw
       JOIN workouts w ON w.id = pw.workout_id
       LEFT JOIN workout_routines wr ON wr.id = w.routine_id
       LEFT JOIN program_routines pr ON pr.id = pw.program_routine_id
       LEFT JOIN workout_exercises we ON we.workout_id = w.id
       LEFT JOIN workout_sets ws ON ws.workout_exercise_id = we.id
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
       JOIN workouts w ON w.id = pw.workout_id
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN exercises e ON e.id = we.exercise_id
       JOIN workout_sets ws ON ws.workout_exercise_id = we.id
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

module.exports = {
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
