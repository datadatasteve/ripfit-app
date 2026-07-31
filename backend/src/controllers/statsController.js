// backend/src/controllers/statsController.js
// All stats/analytics endpoints. Accepts optional ?targetUserId= for trainer access
// (authorization enforcement to be added when trainer portal is built).

const { pool } = require('../config/database');

// Helper: resolve which user's data to query.
// For now, trainers aren't enforced — just use the requesting user.
// When trainer portal is built, add role check here.
function resolveUserId(req) {
  return req.query.targetUserId
    ? parseInt(req.query.targetUserId)
    : req.user.userId;
}

// ── GET /api/v1/stats/overview ─────────────────────────────────────────────
// Returns:
//   - workouts per week (last 12 weeks)
//   - time-of-day distribution (hour buckets)
//   - day-of-week distribution
//   - duration distribution (for box-and-whisker)
//   - avg session rating over time
//   - total workout count, total time
async function getOverview(req, res) {
  const userId = resolveUserId(req);
  const { weeks = 12 } = req.query;

  try {
    // Weekly frequency (strength + cardio combined)
    // Use workout_date/session_date as fallback if start_time is null
    const weeksCond = weeks < 500
      ? `AND COALESCE(start_time, workout_date::timestamptz) >= NOW() - ('${parseInt(weeks)} weeks')::INTERVAL`
      : '';
    const weeksCond2 = weeks < 500
      ? `AND COALESCE(start_time, session_date::timestamptz) >= NOW() - ('${parseInt(weeks)} weeks')::INTERVAL`
      : '';

    const weeklyFreq = await pool.query(`
      SELECT
        DATE_TRUNC('week', d) AS week_start,
        COUNT(*) AS count
      FROM (
        SELECT COALESCE(start_time, workout_date::timestamptz) AS d FROM workouts
        WHERE user_id = $1 AND (status = 'completed' OR (status IS NULL AND end_time IS NOT NULL)) ${weeksCond}
        UNION ALL
        SELECT COALESCE(start_time, session_date::timestamptz) AS d FROM cardio_sessions
        WHERE user_id = $1 AND status = 'finished' ${weeksCond2}
      ) combined
      WHERE d IS NOT NULL
      GROUP BY week_start
      ORDER BY week_start
    `, [userId]);

    // Time-of-day distribution (0-23 hour buckets)
    const timeOfDay = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM d)::INTEGER AS hour,
        COUNT(*) AS count
      FROM (
        SELECT start_time AS d FROM workouts
        WHERE user_id = $1 AND (status = 'completed' OR (status IS NULL AND end_time IS NOT NULL)) AND start_time IS NOT NULL
        UNION ALL
        SELECT start_time AS d FROM cardio_sessions
        WHERE user_id = $1 AND status = 'finished' AND start_time IS NOT NULL
      ) combined
      GROUP BY hour
      ORDER BY hour
    `, [userId]);

    // Day-of-week — fall back to workout_date when start_time is missing
    const dayOfWeek = await pool.query(`
      SELECT
        EXTRACT(DOW FROM d)::INTEGER AS dow,
        COUNT(*) AS count
      FROM (
        SELECT COALESCE(start_time, workout_date::timestamptz) AS d FROM workouts
        WHERE user_id = $1 AND (status = 'completed' OR (status IS NULL AND end_time IS NOT NULL))
        UNION ALL
        SELECT COALESCE(start_time, session_date::timestamptz) AS d FROM cardio_sessions
        WHERE user_id = $1 AND status = 'finished'
      ) combined
      WHERE d IS NOT NULL
      GROUP BY dow
      ORDER BY dow
    `, [userId]);

    // Duration distribution — strength uses end_time-start_time, cardio has its own column
    const durations = await pool.query(`
      SELECT
        EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER AS duration_seconds,
        'strength' AS type,
        start_time
      FROM workouts
      WHERE user_id = $1 AND (status = 'completed' OR status IS NULL)
        AND end_time IS NOT NULL AND start_time IS NOT NULL
        AND end_time > start_time
      UNION ALL
      SELECT duration_seconds, 'cardio' AS type, start_time
      FROM cardio_sessions
      WHERE user_id = $1 AND status = 'finished'
        AND duration_seconds IS NOT NULL AND duration_seconds > 0
      ORDER BY start_time
    `, [userId]);

    // Session rating over time
    const ratings = await pool.query(`
      SELECT
        workout_date AS date,
        session_rating AS rating,
        'strength' AS type,
        start_time
      FROM workouts
      WHERE user_id = $1 AND session_rating IS NOT NULL AND (status = 'completed' OR status IS NULL)
      UNION ALL
      SELECT
        session_date AS date,
        session_rating AS rating,
        'cardio' AS type,
        start_time
      FROM cardio_sessions
      WHERE user_id = $1 AND session_rating IS NOT NULL AND status = 'finished'
      ORDER BY start_time
    `, [userId]);

    // Totals
    const totals = await pool.query(`
      SELECT
        COUNT(*)::INTEGER AS total_workouts,
        COALESCE(SUM(dur), 0)::INTEGER AS total_seconds,
        ROUND(AVG(session_rating)::NUMERIC, 2) AS avg_rating
      FROM (
        SELECT
          EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER AS dur,
          session_rating
        FROM workouts
        WHERE user_id = $1 AND (status = 'completed' OR (status IS NULL AND end_time IS NOT NULL))
        UNION ALL
        SELECT duration_seconds AS dur, session_rating FROM cardio_sessions
        WHERE user_id = $1 AND status = 'finished'
      ) all_sessions
    `, [userId]);

    res.json({
      weekly_frequency: weeklyFreq.rows,
      time_of_day: timeOfDay.rows,
      day_of_week: dayOfWeek.rows,
      durations: durations.rows,
      ratings: ratings.rows,
      totals: totals.rows[0],
    });
  } catch (err) {
    console.error('getOverview error:', err);
    res.status(500).json({ error: 'Failed to fetch overview stats' });
  }
}

// ── GET /api/v1/stats/strength ─────────────────────────────────────────────
// Query params:
//   exerciseId  — filter to one exercise
//   muscleGroup — filter by muscles_primary category
//   weeks       — lookback window (default all time)
// Returns per-exercise aggregates + per-session volume/weight series
async function getStrengthStats(req, res) {
  const userId = resolveUserId(req);
  const { exerciseId, muscleGroup, weeks } = req.query;

  try {
    let whereClause = 'w.user_id = $1 AND w.status = \'completed\'';
    const params = [userId];
    let paramIdx = 2;

    if (weeks) {
      whereClause += ` AND w.start_time >= NOW() - ($${paramIdx} || ' weeks')::INTERVAL`;
      params.push(weeks);
      paramIdx++;
    }
    if (exerciseId) {
      whereClause += ` AND we.exercise_id = $${paramIdx}`;
      params.push(parseInt(exerciseId));
      paramIdx++;
    }
    if (muscleGroup) {
      whereClause += ` AND e.muscles_primary ILIKE $${paramIdx}`;
      params.push(`%${muscleGroup}%`);
      paramIdx++;
    }

    // Per-exercise summary across all matching workouts
    const exerciseSummary = await pool.query(`
      SELECT
        e.id AS exercise_id,
        e.name AS exercise_name,
        e.category,
        e.muscles_primary,
        e.muscles_secondary,
        COUNT(DISTINCT w.id) AS sessions_logged,
        COUNT(ws.id) AS total_sets,
        ROUND(AVG(ws.reps_completed)::NUMERIC, 1) AS avg_reps,
        MAX(ws.reps_completed) AS max_reps,
        MIN(ws.reps_completed) AS min_reps,
        ROUND(AVG(ws.weight_used)::NUMERIC, 1) AS avg_weight,
        MAX(ws.weight_used) AS max_weight,
        MIN(ws.weight_used) AS min_weight,
        ROUND(AVG(ws.rpe)::NUMERIC, 1) AS avg_rpe,
        -- Estimated 1RM using Epley formula: weight * (1 + reps/30)
        ROUND(MAX(ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS estimated_1rm
      FROM workouts w
      JOIN workout_exercises we ON w.id = we.workout_id
      JOIN exercises e ON we.exercise_id = e.id
      JOIN workout_sets ws ON we.id = ws.workout_exercise_id
      WHERE ${whereClause}
      GROUP BY e.id, e.name, e.category, e.muscles_primary, e.muscles_secondary
      ORDER BY sessions_logged DESC, e.name
    `, params);

    // Per-session time series for charting (weight/volume over time per exercise)
    const timeSeries = await pool.query(`
      SELECT
        e.id AS exercise_id,
        e.name AS exercise_name,
        w.workout_date,
        w.start_time,
        w.id AS workout_id,
        COUNT(ws.id)::INTEGER AS sets,
        ROUND(AVG(ws.reps_completed)::NUMERIC, 1) AS avg_reps,
        MAX(ws.weight_used) AS max_weight,
        ROUND(AVG(ws.weight_used)::NUMERIC, 1) AS avg_weight,
        -- Total volume = sum(reps * weight) across all sets
        SUM(ws.reps_completed * ws.weight_used)::INTEGER AS volume,
        ROUND(AVG(ws.rpe)::NUMERIC, 1) AS avg_rpe,
        -- Estimated 1RM for this session
        ROUND(MAX(ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS est_1rm
      FROM workouts w
      JOIN workout_exercises we ON w.id = we.workout_id
      JOIN exercises e ON we.exercise_id = e.id
      JOIN workout_sets ws ON we.id = ws.workout_exercise_id
      WHERE ${whereClause}
      GROUP BY e.id, e.name, w.id, w.workout_date, w.start_time
      ORDER BY e.name, w.start_time
    `, params);

    // Problem workout detection
    // Flag workouts where ≥ threshold% of sets were below target
    // and positive flag where ≥ threshold% were above target
    // Threshold from user prefs (default 25%). For now hard-coded, will move to prefs.
    const FLAGS_THRESHOLD = 0.25;

    const problemWorkouts = await pool.query(`
      SELECT
        w.id AS workout_id,
        w.workout_date,
        COALESCE(wr.name, 'Free Lift') AS routine_name,
        COUNT(ws.id)::INTEGER AS total_sets,
        COUNT(CASE WHEN we.target_weight IS NOT NULL AND ws.weight_used < we.target_weight THEN 1 END)::INTEGER AS sets_below_weight,
        COUNT(CASE WHEN we.target_reps IS NOT NULL AND ws.reps_completed < we.target_reps THEN 1 END)::INTEGER AS sets_below_reps,
        COUNT(CASE WHEN we.target_weight IS NOT NULL AND ws.weight_used > we.target_weight THEN 1 END)::INTEGER AS sets_above_weight,
        COUNT(CASE WHEN we.target_reps IS NOT NULL AND ws.reps_completed > we.target_reps THEN 1 END)::INTEGER AS sets_above_reps,
        COUNT(CASE WHEN we.target_sets IS NOT NULL THEN 1 END)::INTEGER AS sets_with_targets
      FROM workouts w
      JOIN workout_exercises we ON w.id = we.workout_id
      JOIN workout_sets ws ON we.id = ws.workout_exercise_id
      LEFT JOIN workout_routines wr ON w.routine_id = wr.id
      WHERE w.user_id = $1 AND w.status = 'completed'
        AND (we.target_weight IS NOT NULL OR we.target_reps IS NOT NULL OR we.target_sets IS NOT NULL)
      GROUP BY w.id, w.workout_date, wr.name
      HAVING COUNT(ws.id) > 0
      ORDER BY w.workout_date DESC
    `, [userId]);

    // Flag each workout
    const flagged = problemWorkouts.rows.map(row => {
      const targetsExist = row.sets_with_targets > 0;
      const shortfall = (row.sets_below_weight + row.sets_below_reps);
      const surplus = (row.sets_above_weight + row.sets_above_reps);
      const denominator = row.total_sets * 2; // weight + reps checks
      const shortRatio = denominator > 0 ? shortfall / denominator : 0;
      const surplusRatio = denominator > 0 ? surplus / denominator : 0;
      return {
        ...row,
        flag: !targetsExist ? null
          : shortRatio >= FLAGS_THRESHOLD ? 'underperformed'
          : surplusRatio >= FLAGS_THRESHOLD ? 'overperformed'
          : null,
        shortfall_ratio: Math.round(shortRatio * 100),
        surplus_ratio: Math.round(surplusRatio * 100),
      };
    }).filter(r => r.flag !== null);

    res.json({
      exercises: exerciseSummary.rows,
      time_series: timeSeries.rows,
      flagged_workouts: flagged,
    });
  } catch (err) {
    console.error('getStrengthStats error:', err);
    res.status(500).json({ error: 'Failed to fetch strength stats' });
  }
}

// ── GET /api/v1/stats/cardio ───────────────────────────────────────────────
async function getCardioStats(req, res) {
  const userId = resolveUserId(req);
  const { cardioType, weeks } = req.query;

  try {
    let whereClause = 'user_id = $1 AND status = \'finished\'';
    const params = [userId];
    let paramIdx = 2;

    if (weeks) {
      whereClause += ` AND start_time >= NOW() - ($${paramIdx} || ' weeks')::INTERVAL`;
      params.push(weeks);
      paramIdx++;
    }
    if (cardioType) {
      whereClause += ` AND cardio_type = $${paramIdx}`;
      params.push(cardioType);
      paramIdx++;
    }

    // Per-type summary
    const summary = await pool.query(`
      SELECT
        cardio_type,
        COUNT(*)::INTEGER AS sessions,
        ROUND(AVG(duration_seconds)::NUMERIC, 0) AS avg_duration_seconds,
        ROUND(AVG(distance)::NUMERIC, 2) AS avg_distance,
        SUM(distance)::NUMERIC AS total_distance,
        ROUND(AVG(avg_speed)::NUMERIC, 2) AS avg_speed,
        ROUND(AVG(avg_heart_rate)::NUMERIC, 0) AS avg_hr,
        MAX(avg_heart_rate)::INTEGER AS max_hr_seen,
        SUM(calories_burned)::INTEGER AS total_calories,
        ROUND(AVG(session_rating)::NUMERIC, 1) AS avg_rating
      FROM cardio_sessions
      WHERE ${whereClause}
      GROUP BY cardio_type
      ORDER BY sessions DESC
    `, params);

    // Time series for charting
    const timeSeries = await pool.query(`
      SELECT
        id AS session_id,
        session_date,
        start_time,
        cardio_type,
        duration_seconds,
        distance,
        distance_unit,
        avg_speed,
        max_speed,
        avg_heart_rate,
        max_heart_rate,
        calories_burned,
        elevation_gain,
        session_rating
      FROM cardio_sessions
      WHERE ${whereClause}
      ORDER BY start_time
    `, params);

    res.json({
      summary: summary.rows,
      time_series: timeSeries.rows,
    });
  } catch (err) {
    console.error('getCardioStats error:', err);
    res.status(500).json({ error: 'Failed to fetch cardio stats' });
  }
}

// ── GET /api/v1/stats/records ──────────────────────────────────────────────
// Auto-detected PRs: heaviest single set, most reps at a weight, best est. 1RM
async function getRecords(req, res) {
  const userId = resolveUserId(req);

  try {
    const records = await pool.query(`
      WITH ranked AS (
        SELECT
          e.id AS exercise_id,
          e.name AS exercise_name,
          e.category,
          ws.weight_used,
          ws.reps_completed,
          ws.rpe,
          w.workout_date,
          w.id AS workout_id,
          -- Epley estimated 1RM
          ROUND((ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS est_1rm,
          -- Rank by est 1RM per exercise
          ROW_NUMBER() OVER (
            PARTITION BY e.id
            ORDER BY (ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30)) DESC
          ) AS rn_1rm,
          -- Rank by raw weight per exercise
          ROW_NUMBER() OVER (
            PARTITION BY e.id
            ORDER BY ws.weight_used DESC, ws.reps_completed DESC
          ) AS rn_weight,
          -- Rank by reps (at any weight) per exercise
          ROW_NUMBER() OVER (
            PARTITION BY e.id
            ORDER BY ws.reps_completed DESC, ws.weight_used DESC
          ) AS rn_reps
        FROM workouts w
        JOIN workout_exercises we ON w.id = we.workout_id
        JOIN exercises e ON we.exercise_id = e.id
        JOIN workout_sets ws ON we.id = ws.workout_exercise_id
        WHERE w.user_id = $1 AND w.status = 'completed'
          AND ws.weight_used > 0 AND ws.reps_completed > 0
      )
      SELECT DISTINCT ON (exercise_id)
        exercise_id, exercise_name, category,
        MAX(CASE WHEN rn_1rm = 1 THEN est_1rm END) OVER (PARTITION BY exercise_id) AS best_est_1rm,
        MAX(CASE WHEN rn_weight = 1 THEN weight_used END) OVER (PARTITION BY exercise_id) AS best_weight,
        MAX(CASE WHEN rn_weight = 1 THEN reps_completed END) OVER (PARTITION BY exercise_id) AS best_weight_reps,
        MAX(CASE WHEN rn_reps = 1 THEN reps_completed END) OVER (PARTITION BY exercise_id) AS most_reps,
        MAX(CASE WHEN rn_reps = 1 THEN weight_used END) OVER (PARTITION BY exercise_id) AS most_reps_weight,
        MIN(workout_date) OVER (PARTITION BY exercise_id) AS first_logged,
        MAX(workout_date) OVER (PARTITION BY exercise_id) AS last_logged
      FROM ranked
      ORDER BY exercise_id, best_est_1rm DESC NULLS LAST
    `, [userId]);

    res.json({ records: records.rows });
  } catch (err) {
    console.error('getRecords error:', err);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
}

// ── GET /api/v1/stats/combined ─────────────────────────────────────────────
// All metrics on a shared date axis for cross-domain correlation view
async function getCombinedStats(req, res) {
  const userId = resolveUserId(req);
  const { weeks = 52 } = req.query;

  try {
    const combined = await pool.query(`
      SELECT
        date,
        type,
        title,
        duration_seconds,
        session_rating,
        volume,
        est_1rm,
        distance,
        avg_heart_rate,
        start_time
      FROM (
        -- Strength sessions
        SELECT
          w.workout_date AS date,
          'strength' AS type,
          COALESCE(wr.name, 'Free Lift') AS title,
          EXTRACT(EPOCH FROM (w.end_time - w.start_time))::INTEGER AS duration_seconds,
          w.session_rating,
          SUM(ws.reps_completed * ws.weight_used)::INTEGER AS volume,
          ROUND(MAX(ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS est_1rm,
          NULL::NUMERIC AS distance,
          NULL::INTEGER AS avg_heart_rate,
          w.start_time
        FROM workouts w
        LEFT JOIN workout_routines wr ON w.routine_id = wr.id
        LEFT JOIN workout_exercises we ON w.id = we.workout_id
        LEFT JOIN workout_sets ws ON we.id = ws.workout_exercise_id
        WHERE w.user_id = $1 AND w.status = 'completed'
          AND w.start_time >= NOW() - ($2 || ' weeks')::INTERVAL
        GROUP BY w.id, wr.name

        UNION ALL

        -- Cardio sessions
        SELECT
          cs.session_date AS date,
          'cardio' AS type,
          cs.cardio_type AS title,
          cs.duration_seconds,
          cs.session_rating,
          NULL::INTEGER AS volume,
          NULL::NUMERIC AS est_1rm,
          cs.distance,
          cs.avg_heart_rate,
          cs.start_time
        FROM cardio_sessions cs
        WHERE cs.user_id = $1 AND cs.status = 'finished'
          AND cs.start_time >= NOW() - ($2 || ' weeks')::INTERVAL
      ) all_sessions
      ORDER BY start_time
    `, [userId, weeks]);

    res.json({ sessions: combined.rows });
  } catch (err) {
    console.error('getCombinedStats error:', err);
    res.status(500).json({ error: 'Failed to fetch combined stats' });
  }
}

// ── GET /api/v1/stats/exercise/:id ─────────────────────────────────────────
// Deep dive on a single exercise
async function getExerciseStats(req, res) {
  const userId = resolveUserId(req);
  const { id } = req.params;

  try {
    // Exercise info
    const exInfo = await pool.query(
      `SELECT id, name, category, subcategory, muscles_primary, muscles_secondary,
              equipment_type, force, level, mechanic
       FROM exercises WHERE id = $1`,
      [id]
    );
    if (exInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    // All sets ever logged for this exercise by this user
    const allSets = await pool.query(`
      SELECT
        ws.set_number,
        ws.reps_completed,
        ws.weight_used,
        ws.rpe,
        w.workout_date,
        w.id AS workout_id,
        w.start_time,
        ROUND((ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS est_1rm
      FROM workouts w
      JOIN workout_exercises we ON w.id = we.workout_id
      JOIN workout_sets ws ON we.id = ws.workout_exercise_id
      WHERE w.user_id = $1 AND we.exercise_id = $2 AND w.status = 'completed'
      ORDER BY w.start_time, ws.set_number
    `, [userId, id]);

    // Per-session aggregates
    const perSession = await pool.query(`
      SELECT
        w.id AS workout_id,
        w.workout_date,
        w.start_time,
        COUNT(ws.id)::INTEGER AS sets,
        ROUND(AVG(ws.reps_completed)::NUMERIC, 1) AS avg_reps,
        MAX(ws.reps_completed) AS max_reps,
        ROUND(AVG(ws.weight_used)::NUMERIC, 1) AS avg_weight,
        MAX(ws.weight_used) AS max_weight,
        MIN(ws.weight_used) AS min_weight,
        SUM(ws.reps_completed * ws.weight_used)::INTEGER AS volume,
        ROUND(AVG(ws.rpe)::NUMERIC, 1) AS avg_rpe,
        ROUND(MAX(ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS est_1rm
      FROM workouts w
      JOIN workout_exercises we ON w.id = we.workout_id
      JOIN workout_sets ws ON we.id = ws.workout_exercise_id
      WHERE w.user_id = $1 AND we.exercise_id = $2 AND w.status = 'completed'
      GROUP BY w.id, w.workout_date, w.start_time
      ORDER BY w.start_time
    `, [userId, id]);

    // All-time bests
    const bests = await pool.query(`
      SELECT
        MAX(ws.weight_used) AS max_weight,
        MAX(ws.reps_completed) AS max_reps,
        ROUND(MAX(ws.weight_used * (1 + ws.reps_completed::NUMERIC / 30))::NUMERIC, 1) AS best_est_1rm,
        COUNT(DISTINCT w.id)::INTEGER AS total_sessions,
        COUNT(ws.id)::INTEGER AS total_sets,
        MIN(w.workout_date) AS first_logged,
        MAX(w.workout_date) AS last_logged
      FROM workouts w
      JOIN workout_exercises we ON w.id = we.workout_id
      JOIN workout_sets ws ON we.id = ws.workout_exercise_id
      WHERE w.user_id = $1 AND we.exercise_id = $2 AND w.status = 'completed'
    `, [userId, id]);

    res.json({
      exercise: exInfo.rows[0],
      bests: bests.rows[0],
      per_session: perSession.rows,
      all_sets: allSets.rows,
    });
  } catch (err) {
    console.error('getExerciseStats error:', err);
    res.status(500).json({ error: 'Failed to fetch exercise stats' });
  }
}

// ── PUT /api/v1/workouts/:id/rating ────────────────────────────────────────
async function rateWorkout(req, res) {
  const { id } = req.params;
  const { session_rating, session_notes } = req.body;
  const userId = req.user.userId;

  if (session_rating !== undefined && (session_rating < 1 || session_rating > 10)) {
    return res.status(400).json({ error: 'Rating must be between 1 and 10' });
  }

  try {
    const result = await pool.query(
      `UPDATE workouts
       SET session_rating = $1, session_notes = $2
       WHERE id = $3 AND user_id = $4
       RETURNING id, session_rating, session_notes`,
      [session_rating || null, session_notes || null, id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('rateWorkout error:', err);
    res.status(500).json({ error: 'Failed to save rating' });
  }
}

// ── PUT /api/v1/users/me/rating-prefs ──────────────────────────────────────
async function updateRatingPrefs(req, res) {
  const { label, scale, display } = req.body;
  const userId = req.user.userId;

  const validDisplays = ['slider', 'stars', 'number', 'emoji'];
  const validScales = [5, 10];

  if (display && !validDisplays.includes(display)) {
    return res.status(400).json({ error: `display must be one of: ${validDisplays.join(', ')}` });
  }
  if (scale && !validScales.includes(parseInt(scale))) {
    return res.status(400).json({ error: 'scale must be 5 or 10' });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET workout_rating_prefs = workout_rating_prefs || $1::jsonb
       WHERE id = $2
       RETURNING workout_rating_prefs`,
      [JSON.stringify({ label, scale: scale ? parseInt(scale) : undefined, display }), userId]
    );
    res.json(result.rows[0].workout_rating_prefs);
  } catch (err) {
    console.error('updateRatingPrefs error:', err);
    res.status(500).json({ error: 'Failed to update rating preferences' });
  }
}

// ── POST /api/v1/admin/reset-password ──────────────────────────────────────
// Dev backdoor: manually reset any user's password by email.
// Protected by ADMIN_SECRET env var.
async function adminResetPassword(req, res) {
  const { email, new_password, secret } = req.body;

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!email || !new_password) {
    return res.status(400).json({ error: 'email and new_password required' });
  }

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
  if (!PASSWORD_REGEX.test(new_password)) {
    return res.status(400).json({ error: 'Password does not meet requirements' });
  }

  try {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email`,
      [hash, email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error('adminResetPassword error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}

module.exports = {
  getOverview,
  getStrengthStats,
  getCardioStats,
  getRecords,
  getCombinedStats,
  getExerciseStats,
  rateWorkout,
  updateRatingPrefs,
  adminResetPassword,
};
