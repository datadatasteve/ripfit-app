// ============================================================================
// Workout Controller
// ============================================================================
const { pool } = require('../config/database');

// ============================================================================
// EXERCISE SEARCH & LOOKUP
// ============================================================================

/**
 * Search exercises by name
 * GET /api/v1/workouts/exercises/search?q=bench&limit=20
 */
const searchExercises = async (req, res) => {
  const { q, limit = 20 } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, description, category, equipment_type
      FROM exercises
      WHERE name ILIKE $1
      ORDER BY name
      LIMIT $2`,
      [`%${q}%`, limit]
    );

    res.json({
      query: q,
      count: result.rows.length,
      exercises: result.rows
    });
  } catch (error) {
    console.error('Exercise search error:', error);
    res.status(500).json({ error: 'Failed to search exercises' });
  }
};

/**
 * Get exercise by ID
 * GET /api/v1/workouts/exercises/:id
 */
const getExerciseById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, description, category, equipment_type
      FROM exercises
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get exercise error:', error);
    res.status(500).json({ error: 'Failed to get exercise' });
  }
};

// ============================================================================
// WORKOUT LOGGING
// ============================================================================

/**
 * Log a workout with exercises and sets
 * POST /api/v1/workouts
 * Body: {
 *   workout_date: "2026-05-06",
 *   routine_id: 1 (optional),
 *   overall_notes: "Great session" (optional),
 *   exercises: [
 *     {
 *       exercise_id: 123,
 *       exercise_notes: "Shoulder felt tight" (optional),
 *       sets: [
 *         { reps: 5, weight: 185, rpe: 8, rest_seconds: 90 },
 *         { reps: 5, weight: 185, rpe: 9 }
 *       ]
 *     }
 *   ]
 * }
 */
const logWorkout = async (req, res) => {
  const { workout_date, routine_id, overall_notes, exercises } = req.body;
  const user_id = req.user.userId;

  if (!workout_date || !exercises || exercises.length === 0) {
    return res.status(400).json({ 
      error: 'workout_date and exercises array required' 
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create workout
    const workoutResult = await client.query(
      `INSERT INTO workouts (user_id, workout_date, routine_id, overall_notes, start_time)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [user_id, workout_date, routine_id || null, overall_notes || null]
    );

    const workout = workoutResult.rows[0];
    const workoutExercises = [];
    const workoutSets = [];

    // Process each exercise
    for (let i = 0; i < exercises.length; i++) {
      const { exercise_id, exercise_notes, sets } = exercises[i];

      if (!exercise_id || !sets || sets.length === 0) {
        throw new Error(`Exercise at index ${i} missing exercise_id or sets`);
      }

      // Create workout_exercise entry
      const exerciseResult = await client.query(
        `INSERT INTO workout_exercises (workout_id, exercise_id, order_index, exercise_notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [workout.id, exercise_id, i + 1, exercise_notes || null]
      );

      const workoutExercise = exerciseResult.rows[0];
      workoutExercises.push(workoutExercise);

      // Create sets for this exercise
      for (let j = 0; j < sets.length; j++) {
        const { reps, weight, rpe, rest_seconds, tempo, set_type, superset_group } = sets[j];

        if (reps == null || weight == null) {
          throw new Error(`Set ${j + 1} of exercise ${i + 1} missing reps or weight`);
        }

        const setResult = await client.query(
          `INSERT INTO workout_sets (
            workout_exercise_id, set_number, reps_completed, weight_used,
            rpe, rest_seconds, tempo, set_type, superset_group
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [
            workoutExercise.id,
            j + 1,
            reps,
            weight,
            rpe || null,
            rest_seconds || null,
            tempo || null,
            set_type || 'normal',
            superset_group || null
          ]
        );

        workoutSets.push(setResult.rows[0]);
      }
    }

    // Update workout end_time
    await client.query(
      `UPDATE workouts SET end_time = NOW() WHERE id = $1`,
      [workout.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      workout,
      exercises: workoutExercises,
      sets: workoutSets
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Log workout error:', error);
    res.status(500).json({ error: error.message || 'Failed to log workout' });
  } finally {
    client.release();
  }
};

/**
 * Get workouts for a user
 * GET /api/v1/workouts?limit=10
 */
const getWorkouts = async (req, res) => {
  const user_id = req.user.userId;
  const { limit = 10 } = req.query;

  try {
    const result = await pool.query(
      `SELECT 
        w.id, w.workout_date, w.start_time, w.end_time, w.overall_notes,
        json_agg(
          json_build_object(
            'exercise_id', we.exercise_id,
            'exercise_name', e.name,
            'exercise_notes', we.exercise_notes,
            'sets', (
              SELECT json_agg(
                json_build_object(
                  'set_number', ws.set_number,
                  'reps', ws.reps_completed,
                  'weight', ws.weight_used,
                  'rpe', ws.rpe
                )
              )
              FROM workout_sets ws
              WHERE ws.workout_exercise_id = we.id
            )
          ) ORDER BY we.order_index
        ) as exercises
       FROM workouts w
       LEFT JOIN workout_exercises we ON w.id = we.workout_id
       LEFT JOIN exercises e ON we.exercise_id = e.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.workout_date DESC, w.start_time DESC
       LIMIT $2`,
      [user_id, limit]
    );

    res.json({
      count: result.rows.length,
      workouts: result.rows
    });
  } catch (error) {
    console.error('Get workouts error:', error);
    res.status(500).json({ error: 'Failed to get workouts' });
  }
};

module.exports = {
  searchExercises,
  getExerciseById,
  logWorkout,
  getWorkouts
};
