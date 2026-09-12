#!/usr/bin/env node
/**
 * One-time exercise import.
 *
 *   node backend/database/seeds/import_exercises.js [--dry-run]
 *
 * Step 1  Import the yuhonas/free-exercise-db dataset, mapped onto RipFit's
 *         categories, equipment values and react-body-highlighter muscle slugs.
 *         Exercises already present (matched on lowercased name) are skipped.
 * Step 2  Match the arhxam fork's demo videos by name and fill in
 *         video_url_male / video_url_female. Prints a match report.
 * Step 3  Write the generated yoga and pilates entries to
 *         yoga_pilates_review.md for human review. These are NOT seeded.
 *
 * Requires migration 021 to have been run first.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../../src/config/database');
const { YOGA_PILATES_ENTRIES } = require('./yoga_pilates_data');

const YUHONAS_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const ARHXAM_URL = 'https://raw.githubusercontent.com/arhxam/free-exercise-db-with-videos/main/data/exercises.json';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Mapping tables ─────────────────────────────────────────────────────────

// yuhonas primaryMuscles → react-body-highlighter slug
const MUSCLE_MAP = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductor',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearm',
  glutes: 'gluteal',
  hamstrings: 'hamstring',
  'hip flexors': 'adductor',
  lats: 'upper-back',
  'lower back': 'lower-back',
  'middle back': 'upper-back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'front-deltoids',
  traps: 'trapezius',
  triceps: 'triceps',
};

// Which RipFit category a strength movement belongs to, keyed by its first
// primary muscle.
const STRENGTH_CATEGORY_BY_MUSCLE = {
  abdominals: 'Abs',
  biceps: 'Arms',
  triceps: 'Arms',
  forearms: 'Arms',
  lats: 'Back',
  'middle back': 'Back',
  'lower back': 'Back',
  traps: 'Back',
  chest: 'Chest',
  quadriceps: 'Legs',
  hamstrings: 'Legs',
  glutes: 'Legs',
  calves: 'Legs',
  abductors: 'Legs',
  adductors: 'Legs',
  neck: 'Neck',
  shoulders: 'Shoulders',
};

const EQUIPMENT_MAP = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  'body only': 'bodyweight',
  bands: 'resistance-band',
  'exercise ball': 'none',
  'medicine ball': 'none',
  'e-z curl bar': 'barbell',
  'foam roll': 'mat',
  other: 'none',
  none: 'none',
};

/** RipFit category for one yuhonas record. */
function mapCategory(entry) {
  const first = (entry.primaryMuscles || [])[0];

  switch (entry.category) {
    case 'stretching':
      return 'Stretch';
    case 'plyometrics':
    case 'strongman':
      return 'Conditioning';
    case 'cardio':
      return 'Cardio';
    case 'olympic weightlifting':
    case 'olympic_weightlifting':
      return 'Legs';
    case 'powerlifting':
    case 'strength':
      return STRENGTH_CATEGORY_BY_MUSCLE[first] || 'Conditioning';
    default:
      return STRENGTH_CATEGORY_BY_MUSCLE[first] || 'Conditioning';
  }
}

function mapMuscles(list) {
  const slugs = (list || []).map(m => MUSCLE_MAP[String(m).toLowerCase()]).filter(Boolean);
  return [...new Set(slugs)];
}

function mapEquipment(equipment) {
  if (!equipment) return 'none';
  return EQUIPMENT_MAP[String(equipment).toLowerCase()] || 'none';
}

const normalizeName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// ── Step 1 ─────────────────────────────────────────────────────────────────
async function importYuhonas() {
  console.log('\n── Step 1: yuhonas/free-exercise-db ──');
  const raw = await fetchJson(YUHONAS_URL);
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  console.log(`Fetched ${entries.length} exercises.`);

  const existing = await pool.query('SELECT id, name FROM exercises');
  const existingByName = new Map(existing.rows.map(r => [normalizeName(r.name), r.id]));
  console.log(`${existingByName.size} exercises already in DB.`);

  let inserted = 0;
  let skipped = 0;
  const insertedNames = [];

  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (!key || existingByName.has(key)) { skipped++; continue; }

    const instructions = Array.isArray(entry.instructions) ? entry.instructions : [];
    const row = {
      name: entry.name.trim(),
      description: instructions.join(' ') || null,
      category: mapCategory(entry),
      subcategory: null,
      equipment_type: mapEquipment(entry.equipment),
      muscles_primary: mapMuscles(entry.primaryMuscles),
      muscles_secondary: mapMuscles(entry.secondaryMuscles),
      force: entry.force || null,
      level: entry.level || null,
      mechanic: entry.mechanic || null,
      instructions: instructions.length ? instructions : null,
    };

    if (!DRY_RUN) {
      const result = await pool.query(
        `INSERT INTO exercises
           (name, description, category, subcategory, equipment_type,
            muscles_primary, muscles_secondary, force, level, mechanic,
            instructions, is_custom, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,NULL)
         RETURNING id`,
        [row.name, row.description, row.category, row.subcategory, row.equipment_type,
         row.muscles_primary, row.muscles_secondary, row.force, row.level, row.mechanic,
         row.instructions]
      );
      existingByName.set(key, result.rows[0].id);
    } else {
      existingByName.set(key, -1);
    }

    inserted++;
    insertedNames.push(row.name);
  }

  console.log(`Inserted: ${inserted}${DRY_RUN ? ' (dry run — nothing written)' : ''}`);
  console.log(`Skipped (already present or unnamed): ${skipped}`);
  return existingByName;
}

// ── Step 2 ─────────────────────────────────────────────────────────────────
async function matchVideos(nameToId) {
  console.log('\n── Step 2: arhxam/free-exercise-db-with-videos ──');

  let raw;
  try {
    raw = await fetchJson(ARHXAM_URL);
  } catch (err) {
    console.error(`Could not fetch the video dataset: ${err.message}`);
    console.error('Skipping video matching. Re-run once the URL is reachable.');
    return;
  }

  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  console.log(`Fetched ${entries.length} video records.`);

  const matched = [];
  const unmatched = [];

  for (const entry of entries) {
    const key = normalizeName(entry.name);
    const id = nameToId.get(key);

    if (!id) { unmatched.push(entry.name); continue; }

    const male = entry.video_url_male || entry.videoUrlMale || null;
    const female = entry.video_url_female || entry.videoUrlFemale || null;
    if (!male && !female) { unmatched.push(`${entry.name} (no video URLs)`); continue; }

    if (!DRY_RUN && id > 0) {
      await pool.query(
        `UPDATE exercises SET video_url_male = $1, video_url_female = $2 WHERE id = $3`,
        [male, female, id]
      );
    }
    matched.push(entry.name);
  }

  console.log('\n=== VIDEO MATCH REPORT ===');
  console.log(`Matched:   ${matched.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log('\n--- Matched ---');
  matched.forEach(n => console.log(`  ✓ ${n}`));
  console.log('\n--- Unmatched ---');
  unmatched.forEach(n => console.log(`  ✗ ${n}`));
  console.log('=== END REPORT ===\n');
}

// ── Step 3 ─────────────────────────────────────────────────────────────────
function writeYogaPilatesReview() {
  console.log('── Step 3: yoga & pilates review file ──');

  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|');
  const lines = [
    '# Yoga & Pilates — Generated Entries for Review',
    '',
    '> Generated by `backend/database/seeds/import_exercises.js`.',
    '> **Not seeded.** Review, correct, then add through the Exercise Manager',
    '> in the admin panel (or write a follow-up seed once approved).',
    '',
    '| name | category | subcategory | equipment_type | muscles_primary | muscles_secondary | instructions | description |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const e of YOGA_PILATES_ENTRIES) {
    const steps = e.instructions.map((s, i) => `${i + 1}. ${s}`).join('<br>');
    lines.push([
      cell(e.name), cell(e.category), cell(e.subcategory), cell(e.equipment_type),
      cell(e.muscles_primary.join(', ')), cell(e.muscles_secondary.join(', ')),
      cell(steps), cell(e.description),
    ].map(c => ` ${c} `).join('|').replace(/^/, '|') + '|');
  }

  const out = path.join(__dirname, 'yoga_pilates_review.md');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`Wrote ${YOGA_PILATES_ENTRIES.length} entries to ${out}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  if (DRY_RUN) console.log('*** DRY RUN — no database writes ***');

  try {
    const nameToId = await importYuhonas();
    await matchVideos(nameToId);
    writeYogaPilatesReview();
    console.log('\nImport complete.');
  } catch (err) {
    console.error('\nImport failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
