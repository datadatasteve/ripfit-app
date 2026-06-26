// ============================================================================
// Routine Controller
// ============================================================================
const { pool } = require('../config/database');

// ============================================================================
// ROUTINE MANAGEMENT
// ============================================================================

/**
 * Create a new routine with exercises
 * POST /api/v1/routines
 * Body: {
 *   name: "Push Day A",
 *   description: "Chest, shoulders, triceps" (optional),
 *   exercises: [
 *     {
 *       exercise_id: 45,
 *       order_index: 1,
 *       target_sets: 3,
 *       target_reps: 8,
 *       target_weight: 185,
 *       superset_group: null,
 *       notes: "Focus on form"
 *     }
 *   ]
 * }
 */

/*
Code Summary:

Verify routine - Check routine exists and belongs to user
Get template - Fetch original routine exercises with target sets/reps/weight
Find last workout - Query most recent workout from this routine (if any)
Get last performance - For each exercise, retrieve actual sets/reps/weight/notes from last time
Create new workout - Start fresh workout linked to routine
Build exercise list - Add exercises with both template values AND last performance data side-by-side
Return - Frontend gets: template (what routine says) + last_performance (what user actually did + notes) per exercise

*/

const createRoutine = async (req, res) => {
  const { name, description, exercises } = req.body;
  const user_id = req.user.userId;

  if (!name || !exercises || exercises.length === 0) {
    return res.status(400).json({ 
      error: 'Routine name and exercises array required' 
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create routine
    const routineResult = await client.query(
      `INSERT INTO workout_routines (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user_id, name, description || null]
    );

    const routine = routineResult.rows[0];
    const routineExercises = [];

    // Add exercises to routine
    for (const ex of exercises) {
      const { exercise_id, order_index, target_sets, target_reps, target_weight, superset_group, notes } = ex;

      if (!exercise_id || !order_index) {
        throw new Error('Each exercise must have exercise_id and order_index');
      }

      const exerciseResult = await client.query(
        `INSERT INTO routine_exercises (
          routine_id, exercise_id, order_index, target_sets, 
          target_reps, target_weight, superset_group, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          routine.id,
          exercise_id,
          order_index,
          target_sets || null,
          target_reps || null,
          target_weight || null,
          superset_group || null,
          notes || null
        ]
      );

      routineExercises.push(exerciseResult.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      routine,
      exercises: routineExercises
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create routine error:', error);
    res.status(500).json({ error: error.message || 'Failed to create routine' });
  } finally {
    client.release();
  }
};

/**
 * Get all routines for a user
 * GET /api/v1/routines
 */
const getRoutines = async (req, res) => {
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT 
        r.id, r.name, r.description, r.is_active, r.created_at,
        COUNT(re.id) as exercise_count
       FROM workout_routines r
       LEFT JOIN routine_exercises re ON r.id = re.routine_id
       WHERE r.user_id = $1
       GROUP BY r.id
       ORDER BY r.is_active DESC, r.name`,
      [user_id]
    );

    res.json({
      count: result.rows.length,
      routines: result.rows
    });
  } catch (error) {
    console.error('Get routines error:', error);
    res.status(500).json({ error: 'Failed to get routines' });
  }
};

/**
 * Get a specific routine with full exercise details
 * GET /api/v1/routines/:id
 */
const getRoutineById = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.userId;

  try {
    // Get routine
    const routineResult = await pool.query(
      `SELECT * FROM workout_routines 
       WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );

    if (routineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Routine not found' });
    }

    const routine = routineResult.rows[0];

    // Get exercises with details
    const exercisesResult = await pool.query(
      `SELECT 
        re.id, re.order_index, re.target_sets, re.target_reps, 
        re.target_weight, re.superset_group, re.notes,
        e.id as exercise_id, e.name as exercise_name, 
        e.category, e.equipment_type
       FROM routine_exercises re
       JOIN exercises e ON re.exercise_id = e.id
       WHERE re.routine_id = $1
       ORDER BY re.order_index`,
      [id]
    );

    res.json({
      ...routine,
      exercises: exercisesResult.rows
    });

  } catch (error) {
    console.error('Get routine error:', error);
    res.status(500).json({ error: 'Failed to get routine' });
  }
};

/**
 * Update a routine
 * PUT /api/v1/routines/:id
 */
const updateRoutine = async (req, res) => {
  const { id } = req.params;
  const { name, description, is_active, exercises } = req.body;
  const user_id = req.user.userId;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE workout_routines 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           is_active = COALESCE($3, is_active),
           updated_at = $4
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [name, description, is_active, new Date().toISOString(), id, user_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Routine not found' });
    }

    const routine = result.rows[0];

    // If a full exercise list was provided, replace the routine's exercises
    // entirely (delete-and-reinsert, same pattern as createRoutine).
    if (Array.isArray(exercises)) {
      await client.query(`DELETE FROM routine_exercises WHERE routine_id = $1`, [id]);

      for (const ex of exercises) {
        const { exercise_id, order_index, target_sets, target_reps, target_weight, superset_group, notes } = ex;
        if (!exercise_id || !order_index) {
          throw new Error('Each exercise must have exercise_id and order_index');
        }
        await client.query(
          `INSERT INTO routine_exercises (
            routine_id, exercise_id, order_index, target_sets,
            target_reps, target_weight, superset_group, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, exercise_id, order_index, target_sets || null, target_reps || null, target_weight || null, superset_group || null, notes || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json(routine);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update routine error:', error);
    res.status(500).json({ error: error.message || 'Failed to update routine' });
  } finally {
    client.release();
  }
};

/**
 * Delete a routine
 * DELETE /api/v1/routines/:id
 */
const deleteRoutine = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `DELETE FROM workout_routines 
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Routine not found' });
    }

    res.json({ message: 'Routine deleted successfully' });
  } catch (error) {
    console.error('Delete routine error:', error);
    res.status(500).json({ error: 'Failed to delete routine' });
  }
};

/**
 * Start a workout from a routine template with last workout history
 * POST /api/v1/routines/:id/start-workout
 * Body: {
 *   workout_date: "2026-05-07"
 * }
 */
const startWorkoutFromRoutine = async (req, res) => {
  const { id } = req.params;
  const { workout_date } = req.body;
  const user_id = req.user.userId;

  if (!workout_date) {
    return res.status(400).json({ error: 'workout_date required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify routine belongs to user
    const routineCheck = await client.query(
      `SELECT id, name FROM workout_routines 
       WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );

    if (routineCheck.rows.length === 0) {
      throw new Error('Routine not found');
    }

    const routine = routineCheck.rows[0];

    // Get routine template exercises
    const templateResult = await client.query(
      `SELECT re.exercise_id, re.order_index, re.target_sets, re.target_reps, 
              re.target_weight, re.superset_group, re.notes,
              e.name as exercise_name, e.category, e.equipment_type
       FROM routine_exercises re
       JOIN exercises e ON re.exercise_id = e.id
       WHERE re.routine_id = $1
       ORDER BY re.order_index`,
      [id]
    );

    if (templateResult.rows.length === 0) {
      throw new Error('Routine has no exercises');
    }

    // Get last workout from this routine
    const lastWorkoutResult = await client.query(
      `SELECT w.id, w.workout_date, w.overall_notes
       FROM workouts w
       WHERE w.user_id = $1 AND w.routine_id = $2 AND w.workout_date <= $3
       ORDER BY w.workout_date DESC, w.start_time DESC
       LIMIT 1`,
      [user_id, id, workout_date]
    );

    let lastWorkoutData = null;

    // If user did this routine before, get their actual performance
    if (lastWorkoutResult.rows.length > 0) {
      const lastWorkout = lastWorkoutResult.rows[0];

      const lastExercisesResult = await client.query(
        `SELECT we.exercise_id, we.exercise_notes,
                json_agg(
                  json_build_object(
                    'set_number', ws.set_number,
                    'reps', ws.reps_completed,
                    'weight', ws.weight_used,
                    'rpe', ws.rpe
                  ) ORDER BY ws.set_number
                ) as sets_completed
         FROM workout_exercises we
         JOIN workout_sets ws ON we.id = ws.workout_exercise_id
         WHERE we.workout_id = $1
         GROUP BY we.id, we.exercise_id, we.exercise_notes`,
        [lastWorkout.id]
      );

      lastWorkoutData = {
        workout_date: lastWorkout.workout_date,
        overall_notes: lastWorkout.overall_notes,
        exercises: lastExercisesResult.rows
      };
    }

    // Create new workout
    const workoutResult = await client.query(
      `INSERT INTO workouts (user_id, workout_date, routine_id, start_time)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, workout_date, id, new Date().toISOString()]
    );

    const workout = workoutResult.rows[0];
    const workoutExercises = [];

    // Add exercises to new workout
    for (const ex of templateResult.rows) {
      // Find last performance for this exercise if exists
      const lastPerformance = lastWorkoutData?.exercises.find(
        le => le.exercise_id === ex.exercise_id
      );

      const exerciseResult = await client.query(
        `INSERT INTO workout_exercises (
          workout_id, exercise_id, order_index, exercise_notes
        ) VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [workout.id, ex.exercise_id, ex.order_index, ex.notes]
      );

      workoutExercises.push({
        ...exerciseResult.rows[0],
        exercise_name: ex.exercise_name,
        category: ex.category,
        equipment_type: ex.equipment_type,
        template: {
          target_sets: ex.target_sets,
          target_reps: ex.target_reps,
          target_weight: ex.target_weight,
          superset_group: ex.superset_group,
          notes: ex.notes
        },
        last_performance: lastPerformance || null
      });
    }

    await client.query('COMMIT');

    res.status(201).json({
      workout,
      routine_name: routine.name,
      exercises: workoutExercises,
      last_workout_date: lastWorkoutData?.workout_date || null,
      previous_overall_notes: lastWorkoutData?.overall_notes || null,
      message: 'Workout started from routine'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Start workout from routine error:', error);
    res.status(500).json({ error: error.message || 'Failed to start workout' });
  } finally {
    client.release();
  }
};

module.exports = {
  createRoutine,
  getRoutines,
  getRoutineById,
  updateRoutine,
  deleteRoutine,
  startWorkoutFromRoutine
};