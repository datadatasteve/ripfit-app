// backend/src/controllers/reviewController.js
// Review snapshots (Phase 1A-2): rules-based daily and weekly summaries,
// generated on request and cached in review_snapshots. No scheduled jobs.
//
// A cached snapshot is returned as is, unless ?refresh=true is sent or the
// period includes the user's today (its data can still change); those are
// regenerated and the cache is updated. Weeks run Monday to Sunday.
//
// Summary: workouts done vs planned (planned = workout days of the user's
// started programs, from the 1A-1 schedule), strength volume, cardio, habits
// hit, active injuries, and average readiness (per-workout check-in, and the
// daily check-in presets). Soft-deleted workouts, sets and segments are left out.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { durationSql } = require('../utils/workoutStatus');
const { todayIn, addDays, weekdayMon0 } = require('../utils/programSchedule');
const { userScheduleItems } = require('./programController');
const { userInfo, ensureStarters, habitPeriodValue, goalValue } = require('./habitController');

function fail(res, err, what) {
  if (err.statusCode === 400) return res.status(400).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(Number(n) * 10 ** d) / 10 ** d);

async function buildSummary(db, uid, periodType, start, end, info) {
  const [workouts, volume, cardio, injuries, readiness, checkins] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS done, COALESCE(SUM(${durationSql('w')}), 0)::int AS seconds,
              COUNT(*) FILTER (WHERE w.program_id IS NOT NULL)::int AS program_done
       FROM workouts w
       WHERE w.user_id = $1 AND w.status = 'completed' AND w.deleted_at IS NULL AND w.workout_date BETWEEN $2 AND $3`,
      [uid, start, end]
    ),
    db.query(
      `SELECT COALESCE(SUM(ws.reps_completed * ws.weight_used), 0)::float AS volume, COUNT(ws.id)::int AS sets,
              COALESCE(SUM(ws.reps_completed), 0)::int AS reps
       FROM workouts w JOIN workout_exercises we ON we.workout_id = w.id
       JOIN workout_sets ws ON ws.workout_exercise_id = we.id AND ws.deleted_at IS NULL
       WHERE w.user_id = $1 AND w.status = 'completed' AND w.deleted_at IS NULL AND w.workout_date BETWEEN $2 AND $3`,
      [uid, start, end]
    ),
    db.query(
      `SELECT COALESCE(SUM(s.duration_seconds), 0)::int AS seconds, COALESCE(SUM(s.distance), 0)::float AS distance,
              COUNT(s.id)::int AS segments
       FROM workouts w JOIN workout_cardio_segments s ON s.workout_id = w.id AND s.deleted_at IS NULL
       WHERE w.user_id = $1 AND w.status = 'completed' AND w.deleted_at IS NULL AND w.workout_date BETWEEN $2 AND $3`,
      [uid, start, end]
    ),
    db.query(
      `SELECT id, body_area, side, status, limit_flag FROM injuries
       WHERE user_id = $1 AND status <> 'resolved' AND start_date <= $3 AND (end_date IS NULL OR end_date >= $2)
       ORDER BY start_date`,
      [uid, start, end]
    ),
    db.query(
      `SELECT AVG(readiness_sleep)::float AS sleep, AVG(readiness_soreness)::float AS soreness,
              AVG(readiness_energy)::float AS energy,
              COUNT(*) FILTER (WHERE readiness_recorded_at IS NOT NULL)::int AS checkins
       FROM workouts WHERE user_id = $1 AND deleted_at IS NULL AND workout_date BETWEEN $2 AND $3
         AND readiness_recorded_at IS NOT NULL`,
      [uid, start, end]
    ),
    db.query(
      `SELECT ci.preset_key, ci.label, AVG(ce.value)::float AS avg, COUNT(*)::int AS days
       FROM checkin_entries ce JOIN checkin_items ci ON ci.id = ce.item_id
       WHERE ce.user_id = $1 AND ce.entry_date BETWEEN $2 AND $3
       GROUP BY ci.preset_key, ci.label, ci.id ORDER BY ci.id`,
      [uid, start, end]
    ),
  ]);

  // Planned = workout days of started programs in the period. A flexible
  // ("x per week") item counts when its week starts inside a weekly period.
  const items = (await userScheduleItems(db, uid, start, end)).filter(it => it.day_type === 'workout');
  const planned = items.filter(it => (it.date ? it.date >= start && it.date <= end
    : periodType === 'week' && it.week_start >= start && it.week_start <= end));

  // Habits: the active ones that apply to this period.
  await ensureStarters(db, uid, info.goals);
  const habitRows = (await db.query(`SELECT * FROM habits WHERE user_id = $1 AND is_active ORDER BY id`, [uid])).rows;
  const habits = [];
  for (const h of habitRows) {
    const target = goalValue(info.goals, h.goal_link) ?? (h.target_value === null ? null : Number(h.target_value));
    if (periodType === 'day') {
      if (h.frequency === 'weekly') continue;
      if (h.frequency === 'specific_days' && !(h.days_of_week || []).includes(weekdayMon0(start))) continue;
      const value = await habitPeriodValue(db, uid, h, start, start);
      habits.push({ id: h.id, name: h.name, value, target, met: target === null ? null : value >= target });
    } else if (h.frequency === 'weekly') {
      const value = await habitPeriodValue(db, uid, h, start, end);
      habits.push({ id: h.id, name: h.name, value, target, met: target === null ? null : value >= target });
    } else {
      // A daily or specific-days habit over a week: days scheduled and days met.
      let scheduled = 0; let met = 0;
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(start, i);
        if (h.frequency === 'specific_days' && !(h.days_of_week || []).includes(i)) continue;
        scheduled += 1;
        if (target !== null && (await habitPeriodValue(db, uid, h, d, d)) >= target) met += 1;
      }
      habits.push({ id: h.id, name: h.name, days_scheduled: scheduled, days_met: met, target, met: target === null ? null : met === scheduled });
    }
  }

  const w = workouts.rows[0]; const v = volume.rows[0]; const c = cardio.rows[0]; const r = readiness.rows[0];
  return {
    workouts: {
      done: w.done,
      planned: planned.length,
      planned_done: planned.filter(it => it.status === 'completed').length,
      planned_skipped: planned.filter(it => it.status === 'skipped').length,
      program_workouts_done: w.program_done,
      minutes: round(w.seconds / 60),
    },
    volume: { total: round(v.volume, 2), sets: v.sets, reps: v.reps },
    cardio: { minutes: round(c.seconds / 60), distance: round(c.distance, 2), segments: c.segments },
    habits: {
      tracked: habits.length,
      hit: habits.filter(h => h.met === true).length,
      list: habits,
    },
    active_injuries: injuries.rows,
    readiness: {
      workout_checkins: r.checkins,
      avg_sleep: round(r.sleep), avg_soreness: round(r.soreness), avg_energy: round(r.energy),
      daily_checkin: checkins.rows.map(x => ({ preset_key: x.preset_key, label: x.label, avg: round(x.avg), days: x.days })),
    },
  };
}

async function snapshot(req, res, periodType) {
  const uid = req.user.userId;
  try {
    const info = await userInfo(pool, uid);
    const today = todayIn(info.timezone);
    const raw = V.take(V.dateStr(periodType === 'day' ? req.query.date : req.query.week_start, periodType === 'day' ? 'date' : 'week_start'));
    const anchor = raw || today;
    const start = periodType === 'day' ? anchor : addDays(anchor, -weekdayMon0(anchor));
    const end = periodType === 'day' ? start : addDays(start, 6);
    const refresh = req.query.refresh === 'true' || (today >= start && today <= end);
    if (!refresh) {
      const cached = await pool.query(
        `SELECT data, generated_at FROM review_snapshots WHERE user_id = $1 AND period_type = $2 AND period_start = $3`,
        [uid, periodType, start]
      );
      if (cached.rows.length) {
        return res.json({ period_type: periodType, period_start: start, period_end: end, generated_at: cached.rows[0].generated_at, cached: true, data: cached.rows[0].data });
      }
    }
    const data = await buildSummary(pool, uid, periodType, start, end, info);
    const saved = await pool.query(
      `INSERT INTO review_snapshots (user_id, period_type, period_start, period_end, data) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, period_type, period_start) DO UPDATE SET data = EXCLUDED.data, period_end = EXCLUDED.period_end, generated_at = NOW()
       RETURNING generated_at`,
      [uid, periodType, start, end, JSON.stringify(data)]
    );
    res.json({ period_type: periodType, period_start: start, period_end: end, generated_at: saved.rows[0].generated_at, cached: false, data });
  } catch (err) { fail(res, err, 'build review'); }
}

// GET /reviews/daily?date=YYYY-MM-DD&refresh=true
const getDaily = (req, res) => snapshot(req, res, 'day');
// GET /reviews/weekly?week_start=YYYY-MM-DD&refresh=true (any date in the week)
const getWeekly = (req, res) => snapshot(req, res, 'week');

module.exports = { getDaily, getWeekly, buildSummary };
