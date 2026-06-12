/**
 * import_wger_exercises.js
 * 
 * Fetches exercises from wger public API and imports only those
 * not already in our DB (de-duplicated by lowercase name match).
 * 
 * Maps wger categories to our category names.
 * Maps wger equipment to our equipment_type names.
 * 
 * Run from backend directory:
 *   node scripts/import_wger_exercises.js
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

// wger category ID -> our category name
const CATEGORY_MAP = {
  8:  'Arms',
  9:  'Legs',
  10: 'Abs',
  11: 'Chest',
  12: 'Back',
  13: 'Shoulders',
  14: 'Cardio',
};

// wger equipment ID -> our equipment_type
const EQUIPMENT_MAP = {
  1:  'Barbell',
  3:  'Dumbbell',
  4:  'Gym mat',
  5:  'Swiss Ball',
  6:  'Pull-up bar',
  7:  'Bodyweight',
  8:  'Bench',
  9:  'Incline bench',
  10: 'Kettlebell',
  11: 'Cable',
  12: 'Machine',
  13: 'Plate',
  14: 'Resistance band',
};

// wger muscle ID -> muscle name
const MUSCLE_MAP = {
  1:  'anterior deltoid',
  2:  'biceps brachii',
  3:  'biceps femoris',
  4:  'brachialis',
  5:  'gluteus maximus',
  6:  'latissimus dorsi',
  7:  'obliquus externus abdominis',
  8:  'pectoralis major',
  9:  'quadriceps femoris',
  10: 'rectus abdominis',
  11: 'soleus',
  12: 'tibialis anterior',
  13: 'trapezius',
  14: 'triceps brachii',
  15: 'brachioradialis',
  16: 'deltoid',
  17: 'gastrocnemius',
  18: 'gluteus medius',
  19: 'hamstrings',
  20: 'infraspinatus',
  21: 'serratus anterior',
  22: 'tensor fasciae latae',
  23: 'teres major',
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllWgerExercises() {
  const results = [];
  let url = 'https://wger.de/api/v2/exerciseinfo/?format=json&language=2&limit=100&offset=0';

  while (url) {
    console.log(`  Fetching: ${url}`);
    const data = await fetchJSON(url);
    results.push(...data.results);
    url = data.next; // null when no more pages
  }
  return results;
}

function getEnglishName(ex) {
  const eng = ex.translations?.find(t => t.language === 2);
  return eng?.name?.trim() || null;
}

function getEnglishDescription(ex) {
  const eng = ex.translations?.find(t => t.language === 2);
  const raw = eng?.description || '';
  // Strip HTML tags
  return raw.replace(/<[^>]*>/g, '').trim() || null;
}

async function main() {
  console.log('Fetching all wger exercises (this may take a minute)...');
  const wgerExercises = await fetchAllWgerExercises();
  console.log(`Fetched ${wgerExercises.length} exercises from wger`);

  // Get existing DB exercise names for de-duplication
  const { rows: existing } = await pool.query('SELECT LOWER(name) as name FROM exercises');
  const existingNames = new Set(existing.map(r => r.name));
  console.log(`DB has ${existingNames.size} existing exercises`);

  let inserted = 0;
  let skipped = 0;
  let noName = 0;

  for (const ex of wgerExercises) {
    const name = getEnglishName(ex);

    if (!name) { noName++; continue; }
    if (existingNames.has(name.toLowerCase())) { skipped++; continue; }

    const category = CATEGORY_MAP[ex.category?.id] || 'General';
    const equipment = ex.equipment?.[0]
      ? (EQUIPMENT_MAP[ex.equipment[0].id] || 'Other')
      : 'Bodyweight';
    const description = getEnglishDescription(ex);
    const musclesPrimary = ex.muscles?.map(m => MUSCLE_MAP[m.id] || m.name_en).filter(Boolean) || [];
    const musclesSecondary = ex.muscles_secondary?.map(m => MUSCLE_MAP[m.id] || m.name_en).filter(Boolean) || [];

    await pool.query(
      `INSERT INTO exercises
        (name, description, category, equipment_type, muscles_primary, muscles_secondary, is_custom)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [name, description, category, equipment, musclesPrimary, musclesSecondary]
    );

    existingNames.add(name.toLowerCase()); // prevent within-run duplicates
    inserted++;
  }

  console.log(`\nDone.`);
  console.log(`  Inserted: ${inserted} new exercises`);
  console.log(`  Skipped:  ${skipped} (already in DB)`);
  console.log(`  No name:  ${noName} (no English translation)`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
