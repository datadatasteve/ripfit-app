// ============================================================================
// Workout status helpers (Phase 0A-1)
//
// One definition each of "activity", "duration" and "local time", shared by
// the controllers and the one-off scripts so the rules can't drift apart.
//
// workouts.start_time / end_time and workout_sets.created_at are
// `timestamp without time zone` holding UTC wall-clock values;
// workout_cardio_segments.created_at is timestamptz. Everything below
// converts explicitly instead of relying on the session TimeZone.
// ============================================================================

const STATUSES = Object.freeze(['in_progress', 'completed', 'cancelled']);
const STALE_HOURS = 24;

/**
 * SQL boolean: the workout has at least one logged set, OR at least one cardio
 * segment, OR is a meditation session with a recorded duration (explicit
 * duration_seconds, or a positive start→end span for rows that predate it).
 */
function activitySql(w = 'w') {
  return `(
    EXISTS (SELECT 1 FROM workout_exercises act_we
            JOIN workout_sets act_ws ON act_ws.workout_exercise_id = act_we.id
            WHERE act_we.workout_id = ${w}.id)
    OR EXISTS (SELECT 1 FROM workout_cardio_segments act_wcs WHERE act_wcs.workout_id = ${w}.id)
    OR (${w}.workout_type = 'meditation'
        AND COALESCE(${w}.duration_seconds, EXTRACT(EPOCH FROM (${w}.end_time - ${w}.start_time))) > 0)
  )`;
}

/**
 * SQL timestamp (naive UTC): the most recent sign of life for a workout — the
 * latest set or cardio segment, else start_time.
 */
function lastActivitySql(w = 'w') {
  return `GREATEST(
    (SELECT MAX(la_ws.created_at) FROM workout_exercises la_we
       JOIN workout_sets la_ws ON la_ws.workout_exercise_id = la_we.id
       WHERE la_we.workout_id = ${w}.id),
    (SELECT MAX(la_wcs.created_at) AT TIME ZONE 'UTC' FROM workout_cardio_segments la_wcs
       WHERE la_wcs.workout_id = ${w}.id),
    ${w}.start_time
  )`;
}

/**
 * SQL integer: the one definition of workout duration in seconds.
 * An explicit duration_seconds (migration 027, written for meditation) wins;
 * otherwise end_time - start_time - total_paused_seconds. NULL while the
 * workout has no end_time. cardio_sessions rows use their own duration_seconds.
 */
function durationSql(w = 'w') {
  // The CASE matters: GREATEST(0, NULL) is 0 in Postgres, which would turn an
  // unfinished workout into a 0-second one.
  return `COALESCE(
    ${w}.duration_seconds,
    CASE WHEN ${w}.end_time IS NOT NULL AND ${w}.start_time IS NOT NULL THEN
      GREATEST(0, EXTRACT(EPOCH FROM (${w}.end_time - ${w}.start_time))::INTEGER
                  - COALESCE(${w}.total_paused_seconds, 0))
    END
  )`;
}

/** SQL text: the user's IANA zone, UTC when unset. `userParam` is e.g. '$1'. */
function userTimezoneSql(userParam) {
  return `COALESCE((SELECT tz_u.timezone FROM users tz_u WHERE tz_u.id = ${userParam}), 'UTC')`;
}

/** SQL timestamp: a naive-UTC column converted to the user's local wall clock. */
function localTimeSql(column, tzSql) {
  return `((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tzSql})`;
}

/** True when `tz` is an IANA zone name both Node and Postgres will accept. */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stale sweep: any of this user's in_progress workouts with no activity for
 * STALE_HOURS (latest set or segment, else start_time) becomes cancelled.
 * Data is kept; end_time stays NULL. Returns the ids that were swept.
 */
async function sweepStaleWorkouts(db, userId) {
  const result = await db.query(
    `UPDATE workouts w SET status = 'cancelled'
     WHERE w.user_id = $1
       AND w.status = 'in_progress'
       AND ${lastActivitySql('w')} < (NOW() AT TIME ZONE 'UTC') - INTERVAL '${STALE_HOURS} hours'
     RETURNING w.id`,
    [userId]
  );
  return result.rows.map(r => r.id);
}

/** Does this workout have activity? */
async function workoutHasActivity(db, workoutId) {
  const result = await db.query(
    `SELECT ${activitySql('w')} AS has_activity FROM workouts w WHERE w.id = $1`,
    [workoutId]
  );
  return !!result.rows[0]?.has_activity;
}

module.exports = {
  STATUSES,
  STALE_HOURS,
  activitySql,
  lastActivitySql,
  durationSql,
  userTimezoneSql,
  localTimeSql,
  isValidTimezone,
  sweepStaleWorkouts,
  workoutHasActivity,
};
