/**
 * Import exercises from free-exercise-db (GitHub) into exercises table
 * Run with: npm run seed:exercises
 * 
 * Data source: https://github.com/yuhonas/free-exercise-db
 * 800+ exercises, public domain, structured JSON
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Direct link to the combined JSON file on GitHub
const EXERCISES_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

/**
 * Fetch all exercises from GitHub JSON file
 * 
 * Why this works: The repo maintains a single exercises.json file with all exercises.
 * No pagination, no authentication, just one simple HTTP GET.
 */
async function fetchExercises() {
  console.log('\n📥 Fetching exercises from free-exercise-db...');
  
  const response = await fetch(EXERCISES_URL);
  
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }
  
  const exercises = await response.json();
  console.log(`✅ Fetched ${exercises.length} exercises\n`);
  
  return exercises;
}

/**
 * Transform exercise data to match our database schema
 * 
 * free-exercise-db format:
 * {
 *   "id": "Alternate_Incline_Dumbbell_Curl",
 *   "name": "Alternate Incline Dumbbell Curl",
 *   "force": "pull",
 *   "level": "beginner",
 *   "mechanic": "isolation",
 *   "equipment": "dumbbell",  // or null
 *   "primaryMuscles": ["biceps"],
 *   "secondaryMuscles": ["forearms"],
 *   "instructions": ["Step 1...", "Step 2..."],
 *   "category": "strength"
 * }
 * 
 * Our schema needs:
 * - name: exercise name (string)
 * - description: instructions joined as text (string)
 * - category: body part/muscle group (string)
 * - equipment_type: equipment needed (string)
 * - is_custom: false (system exercise)
 * - created_by_user_id: null (system exercise)
 */
function transformExercise(exercise) {
  // Skip exercises without a name
  if (!exercise.name || exercise.name.trim() === '') {
    console.log('⚠️  Skipping exercise with no name:', exercise.id);
    return null;
  }
  
  // Map equipment to our equipment types
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
    null: 'Bodyweight',
  };
  
  // Map primary muscle to category
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
  
  // Get primary muscle (first in array) for category
  const primaryMuscle = exercise.primaryMuscles && exercise.primaryMuscles[0]
    ? exercise.primaryMuscles[0].toLowerCase()
    : null;
  
  const category = categoryMap[primaryMuscle] || 'General';
  
  // Get equipment
  const equipmentKey = exercise.equipment ? exercise.equipment.toLowerCase() : null;
  const equipment = equipmentMap[equipmentKey] || 'Bodyweight';
  
  // Join instructions into a single description
  const description = exercise.instructions && exercise.instructions.length > 0
    ? exercise.instructions.join(' ')
    : '';
  
  return {
    name: exercise.name.trim(),
    description: description.trim(),
    category: category,
    equipment_type: equipment,
    is_custom: false,
    created_by_user_id: null,
  };
}

/**
 * Insert exercises into database
 * 
 * Uses a transaction to ensure atomicity:
 * - Delete old system exercises
 * - Insert new exercises
 * - Commit if successful, rollback if error
 */
async function insertExercises(exercises) {
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');
    
    // Delete existing system exercises
    console.log('🗑️  Removing existing system exercises...');
    const deleteResult = await client.query(
      'DELETE FROM exercises WHERE is_custom = false'
    );
    console.log(`  ✓ Deleted ${deleteResult.rowCount} old exercises\n`);
    
    // Insert new exercises
    console.log('💾 Inserting exercises into database...');
    
    const insertQuery = `
      INSERT INTO exercises (name, description, category, equipment_type, is_custom, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
    `;
    
    let insertedCount = 0;
    let skippedCount = 0;
    
    for (const exercise of exercises) {
      const transformed = transformExercise(exercise);
      
      // Skip invalid exercises
      if (!transformed) {
        skippedCount++;
        continue;
      }
      
      try {
        const result = await client.query(insertQuery, [
          transformed.name,
          transformed.description,
          transformed.category,
          transformed.equipment_type,
          transformed.is_custom,
          transformed.created_by_user_id,
        ]);
        
        if (result.rows.length > 0) {
          insertedCount++;
        }
      } catch (err) {
        // Skip duplicates
        if (err.code === '23505') { // Unique constraint violation
          skippedCount++;
        } else {
          throw err; // Re-throw other errors
        }
      }
    }
    
    console.log(`  ✓ Inserted ${insertedCount} exercises`);
    if (skippedCount > 0) {
      console.log(`  ⚠️  Skipped ${skippedCount} exercises (invalid/duplicates)\n`);
    }
    
    // Commit transaction
    await client.query('COMMIT');
    return insertedCount;
    
  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('❌ Database error:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main function
 */
async function main() {
  console.log('\n🏋️  RipFit Exercise Import (free-exercise-db)\n');
  console.log('═'.repeat(50));
  
  try {
    // Step 1: Fetch from GitHub
    const exercises = await fetchExercises();
    
    // Step 2: Insert into database
    const count = await insertExercises(exercises);
    
    console.log('═'.repeat(50));
    console.log(`\n✅ Import complete! ${count} exercises added.\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}