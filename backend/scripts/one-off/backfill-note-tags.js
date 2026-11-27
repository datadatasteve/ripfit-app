#!/usr/bin/env node
// ============================================================================
// backfill-note-tags.js — WRITES note_tags (Phase 1A-2)
//
// Usage (Northflank shell, repo root), after migration 036 has run:
//   node backend/scripts/one-off/backfill-note-tags.js            (dry run: counts only)
//   node backend/scripts/one-off/backfill-note-tags.js --write    (tags existing notes)
//
// Applies the same keyword rules as the app (backend/src/utils/noteTags.js) to
// every existing note: workouts.overall_notes and session_notes,
// workout_exercises.exercise_notes (one tag set per line; "Set N:" lines are
// set notes) and workout_cardio_segments.notes. Safe to run again: each note's
// tags are rebuilt, never duplicated. Soft-deleted rows are tagged too (their
// tags follow the row if it is restored). Uses the app's DB_* variables.
// ============================================================================

const { pool } = require('../../src/config/database');
const { retag, tagsFor, linesOf } = require('../../src/utils/noteTags');

const SOURCES = [
  { type: 'workout_overall', sql: `SELECT w.id, w.user_id, w.id AS workout_id, w.overall_notes AS text FROM workouts w WHERE NULLIF(BTRIM(w.overall_notes), '') IS NOT NULL` },
  { type: 'workout_session', sql: `SELECT w.id, w.user_id, w.id AS workout_id, w.session_notes AS text FROM workouts w WHERE NULLIF(BTRIM(w.session_notes), '') IS NOT NULL` },
  { type: 'exercise', sql: `SELECT we.id, w.user_id, w.id AS workout_id, we.exercise_notes AS text FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE NULLIF(BTRIM(we.exercise_notes), '') IS NOT NULL` },
  { type: 'segment', sql: `SELECT s.id, w.user_id, w.id AS workout_id, s.notes AS text FROM workout_cardio_segments s JOIN workouts w ON w.id = s.workout_id WHERE NULLIF(BTRIM(s.notes), '') IS NOT NULL` },
];

async function main() {
  const write = process.argv.includes('--write');
  const byTag = {};
  const report = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const src of SOURCES) {
      const rows = (await client.query(src.sql)).rows;
      let tagged = 0; let tagCount = 0;
      for (const r of rows) {
        let tags;
        if (write) {
          tags = await retag(client, { userId: r.user_id, workoutId: r.workout_id, sourceType: src.type, sourceId: r.id, text: r.text });
        } else {
          tags = linesOf(src.type, r.text).flatMap(l => tagsFor(l.text));
        }
        if (tags.length) tagged += 1;
        tagCount += tags.length;
        for (const t of tags) byTag[t.tag] = (byTag[t.tag] || 0) + 1;
      }
      report.push({ source: src.type, notes: rows.length, notes_with_tags: tagged, tags: tagCount });
    }
    await client.query(write ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(write ? 'WROTE note tags' : 'DRY RUN (nothing written; add --write to tag)');
  console.table(report);
  console.log('Tags by name:', JSON.stringify(byTag));
  await pool.end();
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
