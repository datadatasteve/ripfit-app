// Program schedule (Phase 1A-1): turns program_routines rows into dated items.
//
// Dates. A fixed-schedule day sits on (week_number, day_of_week), where
// day_of_week is 0 = Monday … 6 = Sunday (the builder's grid). Week N is the
// seven days starting start_date + (N-1)*7, the same week counting as the
// active workout's programWeekFromStart(); the day is the one in that window
// whose weekday matches. A row with scheduled_date (one-off routines, or any
// dated item) uses that date. Flexible ("x per week, any day") rows have a
// week but no weekday: they get the week's window and no single date.
//
// Pauses. Each program_pauses row moves items dated on or after its from_date
// by delay_days, in from_date order. Items already completed or skipped before
// the pause was recorded keep their date (history does not move).

const MS_DAY = 86400000;

const toDate = s => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const fmt = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => fmt(new Date(toDate(s).getTime() + n * MS_DAY));
/** 0 = Monday … 6 = Sunday. */
const weekdayMon0 = s => (toDate(s).getUTCDay() + 6) % 7;
/** A DATE value from pg (a Date at local midnight) or a string → "YYYY-MM-DD". */
const dbDate = v => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
};

/** The user's calendar date today (IANA zone; UTC when unknown). */
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (_) {
    return fmt(new Date());
  }
}

/** day_type with the old meaning filled in (NULL → is_rest_day decides). */
const effectiveDayType = row => row.day_type || (row.is_rest_day ? 'rest_day' : 'workout');

/** SQL: a row that counts as a program workout day (same as before 1A-1 for old rows). */
const WORKOUT_DAY_SQL = (alias) =>
  `(NOT ${alias}.is_rest_day AND COALESCE(${alias}.day_type, 'workout') = 'workout')`;

/** Undelayed date for a row, or null; plus the week window when it has a week. */
function baseDate(program, row) {
  if (row.scheduled_date) return { date: dbDate(row.scheduled_date) };
  if (!program.start_date) return { date: null };
  const start = dbDate(program.start_date);
  const week = row.week_number || 1;
  const weekStart = addDays(start, (week - 1) * 7);
  const window = { week_start: weekStart, week_end: addDays(weekStart, 6) };
  if ((program.schedule_mode || 'fixed') === 'flexible' || row.day_of_week === null || row.day_of_week === undefined) {
    return { date: null, ...window };
  }
  const offset = ((Number(row.day_of_week) - weekdayMon0(weekStart)) % 7 + 7) % 7;
  return { date: addDays(weekStart, offset), ...window };
}

/** Applies pauses to a date. `frozenAt` = when the item was done/skipped (kept in place by later pauses). */
function applyPauses(date, pauses, frozenAt) {
  if (!date) return date;
  let d = date;
  const sorted = [...pauses].sort((a, b) => dbDate(a.from_date).localeCompare(dbDate(b.from_date)) || a.id - b.id);
  for (const p of sorted) {
    if (frozenAt && new Date(frozenAt) < new Date(p.paused_at)) continue;
    if (d >= dbDate(p.from_date)) d = addDays(d, p.delay_days);
  }
  return d;
}

/**
 * Loads the dated schedule for one or more programs (already ownership-checked).
 * Returns items in date order (undated flexible items by week, after dated ones of the same week).
 */
async function loadSchedule(db, programs) {
  if (!programs.length) return [];
  const ids = programs.map(p => p.id);
  const [rowsRes, pausesRes] = await Promise.all([
    db.query(
      `SELECT pr.*, wr.name AS routine_name,
              done.workout_id AS completed_workout_id, done.completed_date, done.created_at AS done_at,
              sk.id AS skip_id, sk.reason AS skip_reason, sk.skipped_at, sk.scheduled_date AS skip_date
       FROM program_routines pr
       LEFT JOIN workout_routines wr ON wr.id = pr.routine_id
       LEFT JOIN LATERAL (
         SELECT pw.workout_id, pw.completed_date, pw.created_at
         FROM program_workouts pw
         JOIN workouts w ON w.id = pw.workout_id AND w.status = 'completed'
         WHERE pw.program_routine_id = pr.id
         ORDER BY pw.completed_date DESC NULLS LAST, pw.id DESC LIMIT 1
       ) done ON TRUE
       LEFT JOIN program_day_skips sk ON sk.program_routine_id = pr.id
       WHERE pr.program_id = ANY($1::int[])
       ORDER BY pr.program_id, pr.week_number, pr.day_of_week NULLS LAST, pr.order_index, pr.id`,
      [ids]
    ),
    db.query(`SELECT * FROM program_pauses WHERE program_id = ANY($1::int[]) ORDER BY from_date, id`, [ids]),
  ]);
  const byProgram = new Map(programs.map(p => [p.id, p]));
  const items = rowsRes.rows.map(row => {
    const program = byProgram.get(row.program_id);
    const pauses = pausesRes.rows.filter(p => p.program_id === row.program_id);
    const base = baseDate(program, row);
    const frozenAt = row.completed_workout_id ? row.done_at : (row.skip_id ? row.skipped_at : null);
    const date = applyPauses(base.date, pauses, frozenAt);
    const shift = base.date && date ? Math.round((toDate(date) - toDate(base.date)) / MS_DAY) : 0;
    return {
      program_id: row.program_id,
      program_name: program.name,
      color: program.color || null,
      program_routine_id: row.id,
      week_number: row.week_number,
      day_of_week: row.day_of_week,
      order_index: row.order_index,
      day_type: effectiveDayType(row),
      routine_id: row.routine_id,
      routine_name: row.routine_name || null,
      title: row.title || null,
      is_one_off: !!row.is_one_off,
      date,
      base_date: base.date,
      shifted_days: shift,
      week_start: base.week_start ? applyPauses(base.week_start, pauses, frozenAt) : null,
      week_end: base.week_end ? applyPauses(base.week_end, pauses, frozenAt) : null,
      time_of_day: row.time_of_day || null,
      planned_time: row.planned_time ? String(row.planned_time).slice(0, 5) : null,
      special_tag: row.special_tag || null,
      special_note: row.special_note || null,
      notes: row.notes || null,
      status: row.completed_workout_id ? 'completed' : (row.skip_id ? 'skipped' : 'scheduled'),
      completed_workout_id: row.completed_workout_id || null,
      skip: row.skip_id ? { reason: row.skip_reason, skipped_at: row.skipped_at, scheduled_date: row.skip_date ? dbDate(row.skip_date) : null } : null,
    };
  });
  const sortKey = it => it.date || it.week_start || '9999-12-31';
  // Same day: by clock time, with morning / afternoon / evening placed at the
  // start of that part of the day; items with no time last.
  const APPROX = { morning: '05:00', afternoon: '12:00', evening: '17:00' };
  const timeSortKey = it => it.planned_time || APPROX[it.time_of_day] || '99:99';
  items.sort((a, b) => sortKey(a).localeCompare(sortKey(b))
    || (a.date ? 0 : 1) - (b.date ? 0 : 1)
    || timeSortKey(a).localeCompare(timeSortKey(b))
    || a.order_index - b.order_index || a.program_routine_id - b.program_routine_id);
  return items;
}

module.exports = {
  todayIn, addDays, weekdayMon0, effectiveDayType, WORKOUT_DAY_SQL, baseDate, applyPauses, loadSchedule, fmtDate: fmt, dbDate,
};
