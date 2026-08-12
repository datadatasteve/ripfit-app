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
  const { q, limit = 50, offset = 0 } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const rawTerm = q.toLowerCase().trim();

    // ----------------------------------------------------------------
    // Subcategory intent detection — check BEFORE abbreviation expansion
    // so "bi", "bis", "bicep", "biceps" etc. map to a subcategory filter
    // rather than being expanded into a name search word.
    // ----------------------------------------------------------------
    let subcategoryFilter = null; // null = no filter; 'Biceps' | 'Triceps'
    let armsOnly = false;         // true = category = Arms (both subcategories)

    if (/\b(bi|bis|bicep|biceps)\b/.test(rawTerm)) {
      subcategoryFilter = 'Biceps';
    } else if (/\b(tri|tris|tricep|triceps)\b/.test(rawTerm)) {
      subcategoryFilter = 'Triceps';
    } else if (/\b(arms?)\b/.test(rawTerm)) {
      armsOnly = true;
    }

    // Normalize search term - abbreviations and jargon
    let searchTerm = rawTerm
      .replace(/\bbb\b/g, 'barbell')
      .replace(/\bdb\b/g, 'dumbbell')
      .replace(/\bdbs\b/g, 'dumbbell')
      .replace(/\bkb\b/g, 'kettlebell')
      .replace(/\btri\b/g, 'tricep')
      .replace(/\btris\b/g, 'tricep')
      .replace(/\bbi\b/g, 'bicep')
      .replace(/\bbis\b/g, 'bicep')
      .replace(/\bshldr\b/g, 'shoulder')
      .replace(/\bshldrs\b/g, 'shoulder')
      .replace(/\boh\b/g, 'overhead')
      .replace(/\bmvmt\b/g, '')
      .trim();

    // Handle common plural/variant forms
    const singularizeTerm = (term) => {
      return term
        .replace(/\bflies\b/g, 'fly')
        .replace(/\bflys\b/g, 'fly')
        .replace(/\bflyes\b/g, 'fly')
        .replace(/\bcrossovers\b/g, 'crossover')
        .replace(/\bpresses\b/g, 'press')
        .replace(/\bcurls\b/g, 'curl')
        .replace(/\brows\b/g, 'row')
        .replace(/\braises\b/g, 'raise')
        .replace(/\bpulls\b/g, 'pull')
        .replace(/\bextensions\b/g, 'extension')
        .replace(/\bdips\b/g, 'dip')
        .replace(/\bpushdowns\b/g, 'pushdown')
        .replace(/\bpulldowns\b/g, 'pulldown')
        .replace(/\bshrugs\b/g, 'shrug')
        .replace(/\bsquats\b/g, 'squat')
        .replace(/\blunges\b/g, 'lunge')
        .replace(/\bdeadlifts\b/g, 'deadlift')
        .replace(/\btwists\b/g, 'twist');
    };

    // ----------------------------------------------------------------
    // Category-only shortcut: if the entire search term is a category
    // keyword (arms / biceps / triceps), skip name LIKE search entirely
    // and just return all exercises in that category/subcategory.
    // ----------------------------------------------------------------
    const isCategoryOnlySearch = (subcategoryFilter || armsOnly) &&
      /^(arms?|bi|bis|bicep|biceps|tri|tris|tricep|triceps)$/.test(rawTerm);

    if (isCategoryOnlySearch) {
      let catQuery, catParams;
      if (subcategoryFilter) {
        catQuery = `SELECT id, name, description, category, subcategory, equipment_type
                    FROM exercises WHERE subcategory = $1 ORDER BY name LIMIT $2 OFFSET $3`;
        catParams = [subcategoryFilter, limit, offset];
      } else {
        catQuery = `SELECT id, name, description, category, subcategory, equipment_type
                    FROM exercises WHERE category = 'Arms' ORDER BY subcategory, name LIMIT $1 OFFSET $2`;
        catParams = [limit, offset];
      }
      const catResult = await pool.query(catQuery, catParams);
      return res.json({
        query: q,
        count: catResult.rows.length,
        exercises: catResult.rows.map(ex => ({
          id: ex.id,
          name: ex.name,
          description: ex.description,
          category: ex.category,
          subcategory: ex.subcategory || null,
          equipment_type: ex.equipment_type
        }))
      });
    }

    const singularized = singularizeTerm(searchTerm);
    const words = singularized.split(/\s+/).filter(Boolean);
    
    // Deduplicate words
    const uniqueWords = [...new Set(words)];

    // Synonym groups: words that should match each other
    const synonyms = {
      'bench': ['bench', 'press'],
      'press': ['press', 'bench'],
      'fly': ['fly', 'flye', 'butterfly', 'pec deck'],
      'machine': ['machine', 'cable', 'smith'],
      'mason': ['mason', 'russian'],
    };

    // Build params array with synonyms expanded
    let allParams = [];
    let wordConditions = [];
    let andParts = [];
    let paramIdx = 1;

    for (const word of uniqueWords) {
      const syns = synonyms[word] || [word];
      const conditions = syns.map((s, i) => `LOWER(name) LIKE $${paramIdx + i}`);
      wordConditions.push(`(${conditions.join(' OR ')})`);
      andParts.push(`(${conditions.join(' OR ')})`);
      allParams.push(...syns.map(s => `%${s}%`));
      paramIdx += syns.length;
    }

    // OR: any word group matches
    const orWhere = wordConditions.join(' OR ');
    // AND: all word groups match
    const andWhere = andParts.join(' AND ');

    // Also match equipment_type
    const equipConditions = uniqueWords.map((w, i) => {
      return `LOWER(equipment_type) LIKE $${paramIdx + i}`;
    });
    const equipOr = equipConditions.join(' OR ');
    allParams.push(...uniqueWords.map(w => `%${w}%`));
    paramIdx += uniqueWords.length;

    // Build subcategory / category WHERE clause (for mixed searches like "db bicep")
    let categoryClause = '';
    if (subcategoryFilter) {
      allParams.push(subcategoryFilter);
      categoryClause = `AND subcategory = $${paramIdx}`;
      paramIdx++;
    } else if (armsOnly) {
      allParams.push('Arms');
      categoryClause = `AND category = $${paramIdx}`;
      paramIdx++;
    }

    // Limit + offset params
    allParams.push(parseInt(limit));
    const limitParam = paramIdx;
    allParams.push(parseInt(offset));
    const offsetParam = paramIdx + 1;

    const result = await pool.query(
      `SELECT id, name, description, category, subcategory, equipment_type
       FROM exercises
       WHERE (${orWhere} OR ${equipOr})
       ${categoryClause}
       ORDER BY 
         CASE WHEN ${andWhere} THEN 0 ELSE 1 END,
         CASE WHEN ${equipOr} THEN 0 ELSE 1 END,
         category, name
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      allParams
    );

    res.json({
      query: q,
      count: result.rows.length,
      exercises: result.rows.map(ex => ({
        id: ex.id,
        name: ex.name,
        description: ex.description,
        category: ex.category,
        subcategory: ex.subcategory || null,
        equipment_type: ex.equipment_type
      }))
    });
  } catch (error) {
    console.error('Exercise search error:', error);
    res.status(500).json({ error: 'Failed to search exercises' });
  }
};

/**
 * Get exercise by ID
 * GET /api/v1/workouts/exercises/:id
 * Optionally decorated with routine count if user is authenticated
 */
const getExerciseById = async (req, res) => {
  const { id } = req.params;
  // Auth header may or may not be present — best-effort
  let user_id = null;
  try {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const jwt = require('jsonwebtoken');
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user_id = decoded.userId;
    }
  } catch (_) {}

  try {
    const result = await pool.query(
      `SELECT id, name, description, category, subcategory, equipment_type,
              muscles_primary, muscles_secondary, force, level, mechanic
       FROM exercises WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    const exercise = result.rows[0];

    // Routine count for this user
    let routineCount = 0;
    if (user_id) {
      const routineResult = await pool.query(
        `SELECT COUNT(DISTINCT r.id) AS count
         FROM workout_routines r
         JOIN routine_exercises re ON re.routine_id = r.id
         WHERE re.exercise_id = $1 AND r.user_id = $2`,
        [id, user_id]
      );
      routineCount = parseInt(routineResult.rows[0].count) || 0;
    }

    res.json({ ...exercise, routine_count: routineCount });
  } catch (error) {
    console.error('Get exercise error:', error);
    res.status(500).json({ error: 'Failed to get exercise' });
  }
};

/**
 * Browse all exercises with pagination + filters
 * GET /api/v1/workouts/exercises?category=Arms&subcategory=Biceps&limit=50&offset=0
 */
const browseExercises = async (req, res) => {
  const { category, subcategory, equipment, limit = 50, offset = 0 } = req.query;

  // Optional auth for routine count badges
  let user_id = null;
  try {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const jwt = require('jsonwebtoken');
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user_id = decoded.userId;
    }
  } catch (_) {}

  try {
    // Build WHERE clause
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (category) {
      conditions.push(`LOWER(category) = LOWER($${paramIdx})`);
      params.push(category);
      paramIdx++;
    }
    if (subcategory) {
      conditions.push(`LOWER(subcategory) = LOWER($${paramIdx})`);
      params.push(subcategory);
      paramIdx++;
    }
    if (equipment) {
      conditions.push(`LOWER(equipment_type) = LOWER($${paramIdx})`);
      params.push(equipment);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM exercises ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Fetch page
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    const result = await pool.query(
      `SELECT id, name, description, category, subcategory, equipment_type
       FROM exercises
       ${whereClause}
       ORDER BY category, subcategory NULLS LAST, name
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    // If user is logged in, get which exercise IDs are in their routines
    let inRoutineIds = new Set();
    if (user_id && result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      const routineCheck = await pool.query(
        `SELECT DISTINCT re.exercise_id
         FROM routine_exercises re
         JOIN workout_routines r ON r.id = re.routine_id
         WHERE r.user_id = $1 AND re.exercise_id = ANY($2)`,
        [user_id, ids]
      );
      inRoutineIds = new Set(routineCheck.rows.map(r => r.exercise_id));
    }

    res.json({
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      exercises: result.rows.map(ex => ({
        id: ex.id,
        name: ex.name,
        description: ex.description,
        category: ex.category,
        subcategory: ex.subcategory || null,
        equipment_type: ex.equipment_type,
        in_user_routine: inRoutineIds.has(ex.id)
      }))
    });
  } catch (error) {
    console.error('Browse exercises error:', error);
    res.status(500).json({ error: 'Failed to browse exercises' });
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

// Add before module.exports
const logWorkoutSet = async (req, res) => {
  const { workoutId } = req.params;
  const { workout_exercise_id, set_number, reps_completed, weight_used, rpe } = req.body;
  const user_id = req.user.userId;

  try {
    const workoutCheck = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2`,
      [workoutId, user_id]
    );

    if (workoutCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    const result = await pool.query(
      `INSERT INTO workout_sets (workout_exercise_id, set_number, reps_completed, weight_used, rpe, set_type)
       VALUES ($1, $2, $3, $4, $5, 'normal') RETURNING *`,
      [workout_exercise_id, set_number, reps_completed, weight_used, rpe || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Log set error:', error);
    res.status(500).json({ error: 'Failed to log set' });
  }
};

const finishWorkout = async (req, res) => {
  const { workoutId } = req.params;
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `UPDATE workouts SET end_time = $1, status = 'completed' WHERE id = $2 AND user_id = $3 RETURNING *`,
      [new Date().toISOString(), workoutId, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Finish workout error:', error);
    res.status(500).json({ error: 'Failed to finish workout' });
  }
};

const cancelWorkout = async (req, res) => {
  const { workoutId } = req.params;
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `UPDATE workouts SET end_time = $1, status = 'cancelled' WHERE id = $2 AND user_id = $3 RETURNING *`,
      [new Date().toISOString(), workoutId, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Cancel workout error:', error);
    res.status(500).json({ error: 'Failed to cancel workout' });
  }
};

const updateWorkoutNotes = async (req, res) => {
  const { workoutId } = req.params;
  const { overall_notes } = req.body;
  const user_id = req.user.userId;

  try {
    const result = await pool.query(
      `UPDATE workouts SET overall_notes = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [overall_notes, workoutId, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update workout notes error:', error);
    res.status(500).json({ error: 'Failed to update workout notes' });
  }
};

// Backend endpoint to add exercises to active workout
const deleteExerciseFromWorkout = async (req, res) => {
  const { workoutId, exerciseId } = req.params;
  const user_id = req.user.userId;

  try {
    const workoutCheck = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2`,
      [workoutId, user_id]
    );

    if (workoutCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    await pool.query(
      `DELETE FROM workout_exercises WHERE id = $1 AND workout_id = $2`,
      [exerciseId, workoutId]
    );

    res.json({ message: 'Exercise removed' });
  } catch (error) {
    console.error('Delete exercise error:', error);
    res.status(500).json({ error: 'Failed to remove exercise' });
  }
};

// Add exercises to workout
const addExerciseToWorkout = async (req, res) => {
  const { workoutId } = req.params;
  const { exercise_id, order_index, exercise_notes, target_sets, target_reps, target_weight } = req.body;
  const user_id = req.user.userId;

  try {
    const workoutCheck = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2`,
      [workoutId, user_id]
    );

    if (workoutCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    const result = await pool.query(
      `INSERT INTO workout_exercises (workout_id, exercise_id, order_index, exercise_notes, target_sets, target_reps, target_weight)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [workoutId, exercise_id, order_index, exercise_notes || null, target_sets || null, target_reps || null, target_weight || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add exercise error:', error);
    res.status(500).json({ error: 'Failed to add exercise' });
  }
};

const updateExerciseNotes = async (req, res) => {
  const { workoutId, exerciseId } = req.params;
  const { notes } = req.body;
  const user_id = req.user.userId;

  try {
    const workoutCheck = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2`,
      [workoutId, user_id]
    );

    if (workoutCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    // Frontend sends complete notes string (including set numbers)
    // Just store it as-is
    const result = await pool.query(
      `UPDATE workout_exercises 
       SET exercise_notes = $1 
       WHERE id = $2 AND workout_id = $3
       RETURNING *`,
      [notes, exerciseId, workoutId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update notes error:', error);
    res.status(500).json({ error: 'Failed to update notes' });
  }
};


// GET /api/v1/workouts/history
const getCombinedHistory = async (req, res) => {
  const user_id = req.user.userId;
  const { limit = 50, offset = 0 } = req.query;
  try {
    const strengthResult = await pool.query(
      `SELECT
        w.id,
        COALESCE(w.workout_type, 'strength') AS type,
        w.workout_date AS date,
        w.start_time, w.end_time,
        EXTRACT(EPOCH FROM (w.end_time - w.start_time))::INTEGER AS duration_seconds,
        COALESCE(w.workout_title, wr.name, 'Open Session') AS title,
        COUNT(DISTINCT we.id) AS exercise_count,
        w.overall_notes, w.status,
        w.session_rating, w.session_notes
       FROM workouts w
       LEFT JOIN workout_routines wr ON w.routine_id = wr.id
       LEFT JOIN workout_exercises we ON w.id = we.workout_id
       WHERE w.user_id = $1 AND w.status != 'cancelled'
       GROUP BY w.id, wr.name
       ORDER BY w.workout_date DESC, w.start_time DESC`,
      [user_id]
    );
    const cardioResult = await pool.query(
      `SELECT
        id, 'cardio' AS type, session_date AS date,
        start_time, end_time, duration_seconds,
        cardio_type AS title, distance, distance_unit,
        calories_burned, avg_heart_rate,
        pre_session_notes, mid_session_notes, post_session_notes,
        status, session_rating, session_notes
       FROM cardio_sessions
       WHERE user_id = $1 AND status != 'cancelled'
       ORDER BY session_date DESC, start_time DESC`,
      [user_id]
    );
    const combined = [
      ...strengthResult.rows,
      ...cardioResult.rows,
    ].sort((a, b) => {
      const da = new Date(a.start_time || a.date);
      const db = new Date(b.start_time || b.date);
      return db - da;
    });
    res.json({
      total: combined.length,
      entries: combined.slice(parseInt(offset), parseInt(offset) + parseInt(limit)),
    });
  } catch (err) {
    console.error('Combined history error:', err);
    res.status(500).json({ error: 'Failed to fetch workout history' });
  }
};

// GET /api/v1/workouts/history/:id  (strength workout detail)
const getWorkoutDetail = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.userId;
  try {
    const workoutResult = await pool.query(
      `SELECT w.*, COALESCE(w.workout_title, wr.name, 'Open Session') AS routine_name
       FROM workouts w
       LEFT JOIN workout_routines wr ON w.routine_id = wr.id
       WHERE w.id = $1 AND w.user_id = $2`,
      [id, user_id]
    );
    if (workoutResult.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    const exercisesResult = await pool.query(
      `SELECT
        we.id, we.exercise_id, we.order_index, we.exercise_notes,
        e.name AS exercise_name, e.category,
        json_agg(
          json_build_object(
            'set_number', ws.set_number,
            'reps', ws.reps_completed,
            'weight', ws.weight_used,
            'rpe', ws.rpe
          ) ORDER BY ws.set_number
        ) FILTER (WHERE ws.id IS NOT NULL) AS sets
       FROM workout_exercises we
       JOIN exercises e ON we.exercise_id = e.id
       LEFT JOIN workout_sets ws ON we.id = ws.workout_exercise_id
       WHERE we.workout_id = $1
       GROUP BY we.id, we.exercise_id, we.order_index, we.exercise_notes, e.name, e.category
       ORDER BY we.order_index`,
      [id]
    );
    res.json({ ...workoutResult.rows[0], exercises: exercisesResult.rows });
  } catch (err) {
    console.error('Workout detail error:', err);
    res.status(500).json({ error: 'Failed to fetch workout detail' });
  }
};

// POST /api/v1/workouts/start-free  (open session / quick cardio)
const startFreeLift = async (req, res) => {
  const { workout_date, workout_title, workout_type = 'open' } = req.body;
  const user_id = req.user.userId;
  if (!workout_date) {
    return res.status(400).json({ error: 'workout_date required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO workouts (user_id, workout_date, routine_id, start_time, workout_title, workout_type)
       VALUES ($1, $2, NULL, $3, $4, $5) RETURNING *`,
      [user_id, workout_date, new Date().toISOString(), workout_title || null, workout_type]
    );
    res.status(201).json({
      workout: result.rows[0],
      routine_name: workout_title || 'Open Session',
      exercises: [],
      last_workout_date: null,
      previous_overall_notes: null,
    });
  } catch (err) {
    console.error('Start workout error:', err);
    res.status(500).json({ error: 'Failed to start workout' });
  }
};

// POST /api/v1/workouts/:workoutId/exercises/:exerciseId/cardio-segments
const logCardioSegment = async (req, res) => {
  const { workoutId, exerciseId } = req.params;
  const user_id = req.user.userId;
  const {
    segment_number, segment_label,
    duration_seconds, distance, distance_unit,
    pace, pace_unit, pace_overridden,
    reps, avg_speed, max_speed, notes,
  } = req.body;

  try {
    const workoutCheck = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2`,
      [workoutId, user_id]
    );
    if (workoutCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    const result = await pool.query(
      `INSERT INTO workout_cardio_segments (
        workout_exercise_id, workout_id, segment_number, segment_label,
        duration_seconds, distance, distance_unit,
        pace, pace_unit, pace_overridden, reps,
        avg_speed, max_speed, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        exerciseId, workoutId, segment_number, segment_label || 'Segment',
        duration_seconds || null, distance || null, distance_unit || null,
        pace || null, pace_unit || null, pace_overridden || false,
        reps || null, avg_speed || null, max_speed || null, notes || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Log cardio segment error:', error);
    res.status(500).json({ error: 'Failed to log cardio segment' });
  }
};

// GET /api/v1/workouts/:workoutId/exercises/:exerciseId/cardio-segments
const getCardioSegments = async (req, res) => {
  const { workoutId, exerciseId } = req.params;
  const user_id = req.user.userId;

  try {
    const workoutCheck = await pool.query(
      `SELECT id FROM workouts WHERE id = $1 AND user_id = $2`,
      [workoutId, user_id]
    );
    if (workoutCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    const result = await pool.query(
      `SELECT * FROM workout_cardio_segments
       WHERE workout_exercise_id = $1 AND workout_id = $2
       ORDER BY segment_number`,
      [exerciseId, workoutId]
    );

    res.json({ segments: result.rows });
  } catch (error) {
    console.error('Get cardio segments error:', error);
    res.status(500).json({ error: 'Failed to fetch cardio segments' });
  }
};

// PUT /api/v1/workouts/:workoutId/type
// Called when exercises are added/removed to keep workout_type accurate
const updateWorkoutType = async (req, res) => {
  const { workoutId } = req.params;
  const user_id = req.user.userId;
  try {
    // Determine type from current exercise categories
    const result = await pool.query(
      `SELECT DISTINCT e.category
       FROM workout_exercises we
       JOIN exercises e ON we.exercise_id = e.id
       WHERE we.workout_id = $1`,
      [workoutId]
    );
    const categories = result.rows.map(r => r.category);
    const hasStrength = categories.some(c => c !== 'Cardio');
    const hasCardio = categories.some(c => c === 'Cardio');
    let workout_type = 'open';
    if (hasStrength && hasCardio) workout_type = 'mixed';
    else if (hasCardio) workout_type = 'cardio';
    else if (hasStrength) workout_type = 'strength';

    await pool.query(
      `UPDATE workouts SET workout_type = $1 WHERE id = $2 AND user_id = $3`,
      [workout_type, workoutId, user_id]
    );
    res.json({ workout_type });
  } catch (err) {
    console.error('Update workout type error:', err);
    res.status(500).json({ error: 'Failed to update workout type' });
  }
};

module.exports = {
  searchExercises,
  getExerciseById,
  browseExercises,
  logWorkout,
  getWorkouts,
  logWorkoutSet,
  updateExerciseNotes,
  updateWorkoutNotes,
  finishWorkout,
  cancelWorkout,
  addExerciseToWorkout,
  deleteExerciseFromWorkout,
  getCombinedHistory,
  getWorkoutDetail,
  startFreeLift,
  logCardioSegment,
  getCardioSegments,
  updateWorkoutType,
};
