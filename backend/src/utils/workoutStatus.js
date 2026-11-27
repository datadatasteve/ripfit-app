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
// Default for users.workout_age_limit_hours (migration 032). The sweep reads
// each user's own value; this is only the fallback for a missing user row.
const STALE_HOURS = 24;

// Allowed values, matching the CHECK constraints in migration 032.
const SESSION_EVENT_TYPES = Object.freeze([
  'started', 'paused', 'resumed', 'cancelled', 'auto_cancelled', 'reopened', 'finished',
]);
const AGE_LIMIT_HOURS_OPTIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 36, 48]);
const PAUSE_NOTE_MINUTES_OPTIONS = Object.freeze([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);

/**
 * SQL boolean: the workout has at least one logged set, OR at least one cardio
 * segment, OR is a meditation session with a recorded duration (explicit
 * duration_seconds, or a positive start→end span for rows that predate it).
 */
function activitySql(w = 'w') {
  return `(
    EXISTS (SELECT 1 FROM workout_exercises act_we
            JOIN (SELECT * FROM workout_sets WHERE deleted_at IS NULL) act_ws ON act_ws.workout_exercise_id = act_we.id
            WHERE act_we.workout_id = ${w}.id)
    OR EXISTS (SELECT 1 FROM (SELECT * FROM workout_cardio_segments WHERE deleted_at IS NULL) act_wcs WHERE act_wcs.workout_id = ${w}.id)
    OR (${w}.workout_type = 'meditation'
        AND COALESCE(${w}.duration_seconds, EXTRACT(EPOCH FROM (${w}.end_time - ${w}.start_time))) > 0)
  )`;
}

/**
 * SQL timestamp (naive UTC): the most recent sign of life for a workout — the
 * latest set, cardio segment or session event (a pause, resume or cancel
 * counts, Phase 0A-2), else start_time. GREATEST skips NULLs.
 */
function lastActivitySql(w = 'w') {
  return `GREATEST(
    (SELECT MAX(la_ws.created_at) FROM workout_exercises la_we
       JOIN (SELECT * FROM workout_sets WHERE deleted_at IS NULL) la_ws ON la_ws.workout_exercise_id = la_we.id
       WHERE la_we.workout_id = ${w}.id),
    (SELECT MAX(la_wcs.created_at) AT TIME ZONE 'UTC' FROM (SELECT * FROM workout_cardio_segments WHERE deleted_at IS NULL) la_wcs
       WHERE la_wcs.workout_id = ${w}.id),
    (SELECT MAX(la_wse.occurred_at) AT TIME ZONE 'UTC' FROM workout_session_events la_wse
       WHERE la_wse.workout_id = ${w}.id),
    ${w}.start_time
  )`;
}

/** SQL timestamp (naive UTC): now, in the same form as the workout columns. */
const NOW_UTC_SQL = `(NOW() AT TIME ZONE 'UTC')`;

/** SQL integer: the user's workout_age_limit_hours. `userParam` is e.g. '$1'. */
function ageLimitHoursSql(userParam) {
  return `COALESCE((SELECT al_u.workout_age_limit_hours FROM users al_u WHERE al_u.id = ${userParam}), ${STALE_HOURS})`;
}

/**
 * SQL timestamp (naive UTC): when a cancelled workout stopped. The latest
 * cancelled / auto_cancelled event; for workouts cancelled before migration
 * 032 (no such event), the last activity.
 */
function cancelTimeSql(w = 'w') {
  return `COALESCE(
    (SELECT MAX(ct_e.occurred_at) AT TIME ZONE 'UTC' FROM workout_session_events ct_e
       WHERE ct_e.workout_id = ${w}.id AND ct_e.event_type IN ('cancelled', 'auto_cancelled')),
    ${lastActivitySql(w)}
  )`;
}

/**
 * SQL integer: whole seconds of the pause still open on the workout (0 when
 * not paused). paused_at is timestamptz.
 */
function openPauseSecondsSql(w = 'w') {
  return `CASE WHEN ${w}.paused_at IS NULL THEN 0
          ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ${w}.paused_at))))::INTEGER END`;
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
 * Insert one workout_session_events row. Pass the transaction's client so the
 * event commits or rolls back with the status change it describes.
 */
async function recordSessionEvent(db, workoutId, eventType, metadata = null) {
  if (!SESSION_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unknown session event type: ${eventType}`);
  }
  await db.query(
    `INSERT INTO workout_session_events (workout_id, event_type, metadata) VALUES ($1, $2, $3)`,
    [workoutId, eventType, metadata == null ? null : JSON.stringify(metadata)]
  );
}

/**
 * Stale sweep: any of this user's in_progress workouts with no activity
 * (latest set, segment or session event, else start_time) for the user's
 * workout_age_limit_hours becomes cancelled. Data is kept; end_time stays NULL.
 *
 * One statement, so the status change and its auto_cancelled event commit
 * together. The event is dated at the last activity (when the workout really
 * stopped), with the sweep time in metadata, so a later reopen counts the
 * idle stretch as a gap rather than as workout time. A pause still open is
 * closed at that same moment.
 * Returns the ids that were swept.
 */
async function sweepStaleWorkouts(db, userId) {
  const result = await db.query(
    `WITH stale AS (
       SELECT w.id, ${lastActivitySql('w')} AS last_activity
       FROM (SELECT * FROM workouts WHERE deleted_at IS NULL) w
       WHERE w.user_id = $1
         AND w.status = 'in_progress'
         AND ${lastActivitySql('w')}
             < ${NOW_UTC_SQL} - make_interval(hours => ${ageLimitHoursSql('$1')})
       FOR UPDATE OF w
     ), swept AS (
       UPDATE workouts w
       SET status = 'cancelled',
           total_paused_seconds = COALESCE(w.total_paused_seconds, 0) + CASE
             WHEN w.paused_at IS NULL THEN 0
             ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ((stale.last_activity AT TIME ZONE 'UTC') - w.paused_at))))::INTEGER
           END,
           paused_at = NULL
       FROM stale
       WHERE w.id = stale.id
       RETURNING w.id, stale.last_activity
     )
     INSERT INTO workout_session_events (workout_id, event_type, occurred_at, metadata)
     SELECT swept.id, 'auto_cancelled', swept.last_activity AT TIME ZONE 'UTC',
            jsonb_build_object('swept_at', NOW(), 'age_limit_hours', ${ageLimitHoursSql('$1')})
     FROM swept
     RETURNING workout_id`,
    [userId]
  );
  return result.rows.map(r => r.workout_id);
}

/**
 * The one query behind GET /workouts/attention, GET /workouts/active and
 * reopen: the user's in_progress workouts plus cancelled workouts whose last
 * activity is within the user's workout_age_limit_hours. Newest first.
 * Pass `workoutId` to look at one workout (it is returned only if it
 * qualifies). Timestamps come back as timestamptz (ISO strings in JSON).
 */
async function listAttentionWorkouts(db, userId, { workoutId = null, status = null } = {}) {
  const result = await db.query(
    `SELECT w.id,
            COALESCE(w.workout_title, wr.name, 'Open Session') AS title,
            w.status,
            w.workout_type,
            w.start_time AT TIME ZONE 'UTC' AS start_time,
            ${lastActivitySql('w')} AT TIME ZONE 'UTC' AS last_activity_at,
            (w.paused_at IS NOT NULL) AS paused,
            w.paused_at,
            (SELECT COUNT(*)::INTEGER FROM workout_exercises sc_we
               JOIN (SELECT * FROM workout_sets WHERE deleted_at IS NULL) sc_ws ON sc_ws.workout_exercise_id = sc_we.id
               WHERE sc_we.workout_id = w.id) AS set_count,
            CASE WHEN w.status = 'cancelled' THEN ${cancelTimeSql('w')} AT TIME ZONE 'UTC' END AS cancelled_at
     FROM (SELECT * FROM workouts WHERE deleted_at IS NULL) w
     LEFT JOIN workout_routines wr ON wr.id = w.routine_id
     WHERE w.user_id = $1
       AND ($2::integer IS NULL OR w.id = $2::integer)
       AND ($3::text IS NULL OR w.status = $3::text)
       AND (
         w.status = 'in_progress'
         OR (w.status = 'cancelled'
             AND ${lastActivitySql('w')}
                 >= ${NOW_UTC_SQL} - make_interval(hours => ${ageLimitHoursSql('$1')}))
       )
     ORDER BY w.start_time DESC, w.id DESC`,
    [userId, workoutId, status]
  );
  return result.rows;
}

/** Does this workout have activity? */
async function workoutHasActivity(db, workoutId) {
  const result = await db.query(
    `SELECT ${activitySql('w')} AS has_activity FROM (SELECT * FROM workouts WHERE deleted_at IS NULL) w WHERE w.id = $1`,
    [workoutId]
  );
  return !!result.rows[0]?.has_activity;
}

module.exports = {
  STATUSES,
  STALE_HOURS,
  SESSION_EVENT_TYPES,
  AGE_LIMIT_HOURS_OPTIONS,
  PAUSE_NOTE_MINUTES_OPTIONS,
  NOW_UTC_SQL,
  activitySql,
  lastActivitySql,
  ageLimitHoursSql,
  cancelTimeSql,
  openPauseSecondsSql,
  recordSessionEvent,
  listAttentionWorkouts,
  durationSql,
  userTimezoneSql,
  localTimeSql,
  isValidTimezone,
  sweepStaleWorkouts,
  workoutHasActivity,
};
