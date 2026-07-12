/**
 * seed-exercises.js
 * Called at server startup. Imports exercises from free-exercise-db only if
 * the exercises table is empty. Safe to run on every boot — skips if data exists.
 */

const { Pool } = require('pg');

const EXERCISES_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

const equipmentMap = {
  'barbell': 'Barbell',
  'dumbbell': 'Dumbbell',
  'body only': 'Bodyweight',
  'cable': 'Cable',
  'machine': 'Machine',
  'kettlebells': 'Kettlebell',
  'bands': 'Resistance Band',
  'medicine ball': 'Medicine Ball',
  'exercise ball': 'Exercise Ball',
  'foam roll': 'Foam Roller',
  'e-z curl bar': 'EZ Bar',
};

const categoryMap = {
  'biceps': 'Arms',
  'triceps': 'Arms',
  'forearms': 'Arms',
  'chest': 'Chest',
  'lats': 'Back',
  'middle back': 'Back',
  'lower back': 'Back',
  'traps': 'Back',
  'shoulders': 'Shoulders',
  'abdominals': 'Abs',
  'obliques': 'Abs',
  'quadriceps': 'Legs',
  'hamstrings': 'Legs',
  'calves': 'Legs',
  'glutes': 'Legs',
  'adductors': 'Legs',
  'abductors': 'Legs',
  'neck': 'Neck',
};

function transformExercise(exercise) {
  if (!exercise.name || exercise.name.trim() === '') return null;

  const primaryMuscle = exercise.primaryMuscles?.[0]?.toLowerCase() || null;
  const category = categoryMap[primaryMuscle] || 'General';
  const equipmentKey = exercise.equipment?.toLowerCase() || null;
  const equipment = equipmentMap[equipmentKey] || 'Bodyweight';
  const description = exercise.instructions?.join(' ').trim() || '';

  return {
    name: exercise.name.trim(),
    description,
    category,
    equipment_type: equipment,
    is_custom: false,
    created_by_user_id: null,
  };
}

async function seedExercisesIfEmpty() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM exercises');
    const count = parseInt(rows[0].count, 10);

    if (count > 0) {
      console.log(`✓ Exercises already seeded (${count} found), skipping import.`);
      return;
    }

    console.log('No exercises found — fetching from free-exercise-db...');
    const response = await fetch(EXERCISES_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const exercises = await response.json();
    console.log(`Fetched ${exercises.length} exercises, inserting...`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // No ON CONFLICT needed — table is empty, duplicates within the source
      // data are handled by skipping on unique violation (code 23505).
      const insertQuery = `
        INSERT INTO exercises (name, description, category, equipment_type, is_custom, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;

      let inserted = 0;
      for (const ex of exercises) {
        const t = transformExercise(ex);
        if (!t) continue;
        try {
          await client.query(insertQuery, [
            t.name, t.description, t.category, t.equipment_type, t.is_custom, t.created_by_user_id
          ]);
          inserted++;
        } catch (err) {
          if (err.code !== '23505') throw err; // re-throw anything other than duplicate
        }
      }

      await client.query('COMMIT');
      console.log(`✓ Seeded ${inserted} exercises.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Exercise seed failed (server will still start):', err.message);
  } finally {
    // End this pool quietly — ignore double-end errors
    try { await pool.end(); } catch (_) {}
  }
}

module.exports = seedExercisesIfEmpty;
