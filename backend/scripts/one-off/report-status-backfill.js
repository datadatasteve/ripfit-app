#!/usr/bin/env node
// ============================================================================
// report-status-backfill.js — READ-ONLY (Phase 0A-1)
//
// Usage (Northflank shell, repo root):
//   node backend/scripts/one-off/report-status-backfill.js
//
// Applies migration 030's status backfill rule to every workout WITHOUT
// writing anything, and prints:
//   - how many workouts end up in each status under the rule
//   - the current status counts, and rule-vs-current differences
//   - every workout that would be (or is) cancelled while having logged sets,
//     so they can be reviewed
//   - cardio-segment-only workouts and meditation sessions, which must not be
//     cancelled
// Uses the same pg Pool and DB_* environment variables as the app. Never
// writes: it runs inside a READ ONLY transaction that is rolled back.
// ============================================================================

const { pool } = require('../../src/config/database');
const { activitySql } = require('../../src/utils/workoutStatus');

// Migration 030's rule. Rows already explicitly 'cancelled' stay cancelled.
const RULE_SQL = `CASE
  WHEN w.status = 'cancelled' THEN 'cancelled'
  WHEN w.end_time IS NOT NULL AND ${activitySql('w')} THEN 'completed'
  WHEN w.end_time IS NULL AND w.start_time IS NOT NULL
       AND (w.start_time AT TIME ZONE 'UTC') >= NOW() - INTERVAL '24 hours' THEN 'in_progress'
  ELSE 'cancelled'
END`;

const SET_COUNT_SQL = `(SELECT COUNT(*) FROM workout_exercises we
   JOIN workout_sets ws ON ws.workout_exercise_id = we.id WHERE we.workout_id = w.id)::int`;
const SEGMENT_COUNT_SQL = `(SELECT COUNT(*) FROM workout_cardio_segments wcs WHERE wcs.workout_id = w.id)::int`;

function table(rows) {
  if (rows.length === 0) { console.log('  (none)'); return; }
  console.table(rows);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');

    const { rows } = await client.query(`
      SELECT w.id, u.email, w.workout_date::text AS date,
             COALESCE(w.workout_title, wr.name, '') AS title,
             w.workout_type AS type, w.status AS current_status,
             ${RULE_SQL} AS rule_status,
             w.start_time, w.end_time,
             ${SET_COUNT_SQL} AS sets, ${SEGMENT_COUNT_SQL} AS segments,
             w.duration_seconds
      FROM workouts w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN workout_routines wr ON wr.id = w.routine_id
      ORDER BY w.id`);

    const count = (key) => rows.reduce((m, r) => ({ ...m, [r[key] ?? 'NULL']: (m[r[key] ?? 'NULL'] || 0) + 1 }), {});

    console.log(`\nWorkouts scanned: ${rows.length}\n`);
    console.log('Status under the backfill rule:');
    console.table(count('rule_status'));
    console.log('Current status in the database:');
    console.table(count('current_status'));

    const diffs = rows.filter(r => r.current_status !== r.rule_status);
    console.log(`Rows whose current status differs from the rule: ${diffs.length}`);
    table(diffs.map(r => ({ id: r.id, date: r.date, title: r.title, current: r.current_status, rule: r.rule_status, sets: r.sets })));

    const cancelledWithSets = rows.filter(r => r.rule_status === 'cancelled' && r.sets > 0);
    console.log(`\nWould be cancelled but HAVE logged sets (review these): ${cancelledWithSets.length}`);
    table(cancelledWithSets.map(r => ({
      id: r.id, email: r.email, date: r.date, title: r.title, type: r.type,
      why: r.current_status === 'cancelled' ? 'explicitly cancelled' : (r.end_time ? 'no activity?' : 'never finished, >24h old'),
      sets: r.sets, start: r.start_time, end: r.end_time,
    })));

    const explicit = rows.filter(r => r.current_status === 'cancelled' && r.end_time && r.sets > 0);
    console.log(`\nExplicitly cancelled with end time and sets (kept cancelled by decision): ${explicit.length}`);

    const segOnly = rows.filter(r => r.sets === 0 && r.segments > 0);
    console.log(`\nCardio-segment-only workouts: ${segOnly.length} (rule: ${JSON.stringify(segOnly.reduce((m, r) => ({ ...m, [r.rule_status]: (m[r.rule_status] || 0) + 1 }), {}))})`);
    table(segOnly.filter(r => r.rule_status !== 'completed').map(r => ({ id: r.id, date: r.date, title: r.title, rule: r.rule_status, end: r.end_time })));

    const med = rows.filter(r => r.type === 'meditation');
    console.log(`\nMeditation sessions: ${med.length} (rule: ${JSON.stringify(med.reduce((m, r) => ({ ...m, [r.rule_status]: (m[r.rule_status] || 0) + 1 }), {}))})`);
    table(med.filter(r => r.rule_status !== 'completed').map(r => ({ id: r.id, date: r.date, title: r.title, rule: r.rule_status, duration_seconds: r.duration_seconds, end: r.end_time })));

    await client.query('ROLLBACK');
    console.log('\nRead-only report: nothing was changed.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('Report failed:', err.message); process.exit(1); });
