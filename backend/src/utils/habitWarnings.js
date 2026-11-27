// Advisory warnings for habits and program goals (Phase 1A-2).
//
// WARNING_RULES is the one place to tweak. Each rule is a small config entry:
// code, message, severity ('advisory'), the measure it checks and its limit.
// Warnings never block saving: create/update return them next to the record.
// Only the two rules the owner asked for are here (no other medical thresholds).

const PROFESSIONAL = 'If you have a health condition, an injury or any doubt, consult a qualified professional (doctor, physical therapist or coach) first.';

const WARNING_RULES = [
  {
    code: 'workouts_per_week_no_rest',
    severity: 'advisory',
    measure: 'workouts_per_week',
    limit: 6,   // more than this = no rest day in the week
    message: `This plans more than 6 workouts a week, which leaves no rest day. Rest days help you recover and lower injury risk. ${PROFESSIONAL}`,
  },
  {
    code: 'minutes_per_day_high',
    severity: 'advisory',
    measure: 'minutes_per_day',
    limit: 120,
    message: `This plans more than 120 minutes of training a day. That is a lot of volume to recover from. ${PROFESSIONAL}`,
  },
];

const WORKOUT_UNITS = new Set(['workout', 'workouts', 'session', 'sessions']);
const MINUTE_UNITS = new Set(['min', 'mins', 'minute', 'minutes']);

/**
 * What a habit asks for, in the rules' measures:
 * { workouts_per_week, minutes_per_day } (null when it doesn't say).
 */
function habitMeasures(h) {
  const target = h.target_value === null || h.target_value === undefined || h.target_value === '' ? null : Number(h.target_value);
  if (target === null || !Number.isFinite(target)) return {};
  const unit = String(h.unit || '').trim().toLowerCase();
  const isWorkouts = h.auto_metric === 'workouts_completed' || WORKOUT_UNITS.has(unit);
  const isMinutes = ['workout_minutes', 'cardio_minutes'].includes(h.auto_metric) || MINUTE_UNITS.has(unit);
  const daysPerWeek = h.frequency === 'specific_days' ? (h.days_of_week || []).length : 7;
  const out = {};
  if (isWorkouts) {
    out.workouts_per_week = h.frequency === 'weekly' ? target : target * daysPerWeek;
  }
  if (isMinutes) {
    out.minutes_per_day = h.frequency === 'weekly' ? target / 7 : target;
  }
  return out;
}

/** A program goal's measure comes from its metric name; the higher of target and threshold is checked. */
function goalMeasures(g) {
  const vals = [g.target_value, g.threshold_value].filter(v => v !== null && v !== undefined && v !== '').map(Number).filter(Number.isFinite);
  if (!vals.length) return {};
  const v = Math.max(...vals);
  if (g.metric === 'workouts_per_week') return { workouts_per_week: v };
  if (g.metric === 'minutes_per_day') return { minutes_per_day: v };
  return {};
}

function warningsFor(measures) {
  return WARNING_RULES
    .filter(r => measures[r.measure] !== undefined && measures[r.measure] > r.limit)
    .map(({ code, severity, message }) => ({ code, severity, message }));
}

module.exports = {
  WARNING_RULES,
  habitWarnings: h => warningsFor(habitMeasures(h)),
  goalWarnings: g => warningsFor(goalMeasures(g)),
};
