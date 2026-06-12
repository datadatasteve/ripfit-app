/**
 * import_exercise_metadata.js
 * 
 * Downloads free-exercise-db JSON from GitHub and populates:
 *   muscles_primary, muscles_secondary, force, level, mechanic
 * for existing exercises matched by name (case-insensitive).
 * 
 * Run from backend directory:
 *   node scripts/import_exercise_metadata.js
 */

const { Pool } = require('pg');
const https = require('https');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'ripfit_dev',
  user: 'ripfit_user',
  password: 'ripfit_password', // update if different
});

const EXERCISES_JSON_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching free-exercise-db...');
  const exercises = await fetchJSON(EXERCISES_JSON_URL);
  console.log(`Fetched ${exercises.length} exercises from free-exercise-db`);

  // Build a lookup map: lowercase name -> exercise data
  const sourceMap = new Map();
  for (const ex of exercises) {
    sourceMap.set(ex.name.toLowerCase().trim(), ex);
  }

  // Get all exercises from our DB
  const { rows } = await pool.query('SELECT id, name FROM exercises');
  console.log(`Found ${rows.length} exercises in DB`);

  let updated = 0;
  let notFound = 0;

  for (const row of rows) {
    const key = row.name.toLowerCase().trim();
    const source = sourceMap.get(key);

    if (!source) {
      notFound++;
      continue;
    }

    await pool.query(
      `UPDATE exercises SET
        muscles_primary   = $1,
        muscles_secondary = $2,
        force             = $3,
        level             = $4,
        mechanic          = $5
       WHERE id = $6`,
      [
        source.primaryMuscles   || [],
        source.secondaryMuscles || [],
        source.force     || null,
        source.level     || null,
        source.mechanic  || null,
        row.id
      ]
    );
    updated++;
  }

  console.log(`\nDone.`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Not found: ${notFound} (no name match in free-exercise-db)`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
