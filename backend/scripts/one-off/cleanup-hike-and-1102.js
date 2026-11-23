#!/usr/bin/env node
// ============================================================================
// cleanup-hike-and-1102.js — one-off data cleanup (Phase 0A-1)
//
// Usage (Northflank shell, repo root):
//   node backend/scripts/one-off/cleanup-hike-and-1102.js --email <owner email>            # dry run
//   node backend/scripts/one-off/cleanup-hike-and-1102.js --email <owner email> --confirm  # delete
//
// Dry run is the default and changes nothing. --confirm deletes inside ONE
// transaction, checks for orphans, and rolls everything back on any problem.
//
// 1. Erroneous hike: the owner's workouts and cardio_sessions dated 2026-08-11
//    with a duration over 5 hours. Deleted only if there is EXACTLY ONE such
//    candidate across both tables. With zero or several, the candidates are
//    printed and the script exits WITHOUT deleting anything (11/2 included).
// 2. 11/2/2026 phantoms: prints every workout the owner has on 2026-11-02, then
//    deletes the shoulder workouts (workout title or routine name contains
//    "shoulder") shorter than 10 minutes. Without an end_time the span is
//    start_time → last logged set; with no sets it counts as under 10 minutes.
//    No other workout is touched.
// ============================================================================

const { pool } = require('../../src/config/database');
const { durationSql } = require('../../src/utils/workoutStatus');

const HIKE_DATE = '2026-08-11';
const PHANTOM_DATE = '2026-11-02';
const HIKE_MIN_SECONDS = 5 * 3600;
const PHANTOM_MAX_SECONDS = 10 * 60;

function parseArgs(argv) {
  const args = { email: null, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') args.email = argv[++i];
    else if (argv[i] === '--confirm') args.confirm = true;
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(2); }
  }
  if (!args.email) { console.error('Usage: --email <owner email> [--confirm]'); process.exit(2); }
  return args;
}

// Delete workouts in dependency order. Returns per-table counts.
async function deleteWorkouts(client, ids) {
  if (ids.length === 0) return {};
  const q = async (sql) => (await client.query(sql, [ids])).rowCount;
  return {
    workout_sets: await q(`DELETE FROM workout_sets WHERE workout_exercise_id IN
                           (SELECT id FROM workout_exercises WHERE workout_id = ANY($1))`),
    workout_cardio_segments: await q(`DELETE FROM workout_cardio_segments WHERE workout_id = ANY($1)`),
    workout_exercises: await q(`DELETE FROM workout_exercises WHERE workout_id = ANY($1)`),
    program_workouts: await q(`DELETE FROM program_workouts WHERE workout_id = ANY($1)`),
    // scheduled_workouts.workout_id is ON DELETE SET NULL: the schedule entry stays, unlinked.
    workouts: await q(`DELETE FROM workouts WHERE id = ANY($1)`),
  };
}

async function deleteCardioSessions(client, ids) {
  if (ids.length === 0) return {};
  const q = async (sql) => (await client.query(sql, [ids])).rowCount;
  return {
    cardio_checkpoints: await q(`DELETE FROM cardio_checkpoints WHERE cardio_session_id = ANY($1)`),
    cardio_sessions: await q(`DELETE FROM cardio_sessions WHERE id = ANY($1)`),
  };
}

async function orphanCounts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM workout_sets ws LEFT JOIN workout_exercises we ON we.id = ws.workout_exercise_id WHERE we.id IS NULL)::int AS sets_without_exercise,
      (SELECT COUNT(*) FROM workout_exercises we LEFT JOIN workouts w ON w.id = we.workout_id WHERE w.id IS NULL)::int AS exercises_without_workout,
      (SELECT COUNT(*) FROM workout_cardio_segments s LEFT JOIN workouts w ON w.id = s.workout_id WHERE w.id IS NULL)::int AS segments_without_workout,
      (SELECT COUNT(*) FROM program_workouts pw LEFT JOIN workouts w ON w.id = pw.workout_id WHERE pw.workout_id IS NOT NULL AND w.id IS NULL)::int AS program_rows_without_workout,
      (SELECT COUNT(*) FROM cardio_checkpoints c LEFT JOIN cardio_sessions s ON s.id = c.cardio_session_id WHERE s.id IS NULL)::int AS checkpoints_without_session`);
  return rows[0];
}

async function main() {
  const { email, confirm } = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${confirm ? 'CONFIRM (will delete)' : 'DRY RUN (no changes)'}\n`);

  const client = await pool.connect();
  try {
    const user = await client.query('SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (user.rows.length === 0) { console.error(`No user with email ${email}`); process.exitCode = 1; return; }
    const userId = user.rows[0].id;
    console.log(`Owner: user id ${userId}\n`);

    // ── 1. Hike candidates ───────────────────────────────────────────────────
    const hikeWorkouts = await client.query(`
      SELECT w.id, 'workouts' AS source, COALESCE(w.workout_title, wr.name, '') AS title,
             w.workout_type AS type, w.start_time, w.end_time, ${durationSql('w')} AS duration_seconds
      FROM workouts w LEFT JOIN workout_routines wr ON wr.id = w.routine_id
      WHERE w.user_id = $1 AND w.workout_date = $2 AND ${durationSql('w')} > $3
      ORDER BY w.id`, [userId, HIKE_DATE, HIKE_MIN_SECONDS]);
    const hikeCardio = await client.query(`
      SELECT id, 'cardio_sessions' AS source, cardio_type AS title, 'cardio' AS type, start_time, end_time,
             COALESCE(duration_seconds, EXTRACT(EPOCH FROM (end_time - start_time))::int) AS duration_seconds
      FROM cardio_sessions
      WHERE user_id = $1 AND session_date = $2
        AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (end_time - start_time))::int) > $3
      ORDER BY id`, [userId, HIKE_DATE, HIKE_MIN_SECONDS]);
    const hikeCandidates = [...hikeWorkouts.rows, ...hikeCardio.rows];

    console.log(`1. Hike candidates on ${HIKE_DATE} over 5 hours: ${hikeCandidates.length}`);
    if (hikeCandidates.length) console.table(hikeCandidates);

    // ── 2. 11/2 workouts ─────────────────────────────────────────────────────
    const day = await client.query(`
      SELECT w.id, COALESCE(w.workout_title, wr.name, '') AS title, w.workout_title, wr.name AS routine_name,
             w.workout_type AS type, w.status, w.start_time, w.end_time,
             (SELECT COUNT(*) FROM workout_exercises we JOIN workout_sets ws ON ws.workout_exercise_id = we.id
              WHERE we.workout_id = w.id)::int AS sets,
             CASE
               WHEN w.end_time IS NOT NULL THEN ${durationSql('w')}
               ELSE EXTRACT(EPOCH FROM (
                      (SELECT MAX(ws.created_at) FROM workout_exercises we JOIN workout_sets ws ON ws.workout_exercise_id = we.id
                       WHERE we.workout_id = w.id) - w.start_time))::int
             END AS duration_seconds
      FROM workouts w LEFT JOIN workout_routines wr ON wr.id = w.routine_id
      WHERE w.user_id = $1 AND w.workout_date = $2
      ORDER BY w.start_time NULLS LAST, w.id`, [userId, PHANTOM_DATE]);

    const isShoulder = r => /shoulder/i.test(r.workout_title || '') || /shoulder/i.test(r.routine_name || '');
    // No end_time and no sets → duration NULL → treated as under 10 minutes.
    const isShort = r => r.duration_seconds == null || r.duration_seconds < PHANTOM_MAX_SECONDS;
    const phantoms = day.rows.filter(r => isShoulder(r) && isShort(r));

    console.log(`\n2. All workouts on ${PHANTOM_DATE}: ${day.rows.length}`);
    console.table(day.rows.map(r => ({
      id: r.id, title: r.title, type: r.type, status: r.status, start: r.start_time, end: r.end_time,
      sets: r.sets, duration: r.duration_seconds == null ? '(none)' : `${Math.round(r.duration_seconds / 60)} min`,
      action: phantoms.includes(r) ? 'DELETE' : 'keep',
    })));

    if (hikeCandidates.length !== 1) {
      console.log(`\nExpected exactly one hike candidate, found ${hikeCandidates.length}. Nothing deleted.`);
      return;
    }

    const hike = hikeCandidates[0];
    const workoutIds = [...phantoms.map(r => r.id), ...(hike.source === 'workouts' ? [hike.id] : [])];
    const cardioIds = hike.source === 'cardio_sessions' ? [hike.id] : [];
    console.log(`\nPlan: delete workouts [${workoutIds.join(', ')}], cardio_sessions [${cardioIds.join(', ')}]`);

    if (!confirm) {
      console.log('\nDry run: nothing deleted. Re-run with --confirm to apply.');
      return;
    }

    await client.query('BEGIN');
    try {
      // Compared before/after so orphans that already existed can't block the
      // run, but any new one rolls everything back.
      const before = await orphanCounts(client);
      const w = await deleteWorkouts(client, workoutIds);
      const c = await deleteCardioSessions(client, cardioIds);
      const after = await orphanCounts(client);
      console.log('\nDeleted rows:'); console.table({ ...w, ...c });
      console.log('Orphan check (before → after):');
      console.table(Object.fromEntries(Object.keys(after).map(k => [k, `${before[k]} → ${after[k]}`])));
      if (Object.keys(after).some(k => after[k] > before[k])) throw new Error('new orphan rows found; rolling back');
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('Cleanup failed, nothing changed:', err.message); process.exit(1); });
