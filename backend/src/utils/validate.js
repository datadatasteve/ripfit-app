// Small input validators shared by the Phase 1A controllers.
// Each returns { value } or { error } so a controller can answer 400 with a
// clear message instead of letting bad input reach Postgres (which would 500).

const isBlank = v => v === undefined || v === null || v === '';

/** Whole number in [min, max]; blank → null unless required. */
function intIn(raw, field, min, max, { required = false } = {}) {
  if (isBlank(raw)) return required ? { error: `${field} is required` } : { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${field} must be a whole number from ${min} to ${max}` };
  }
  return { value: n };
}

/** Number ≥ min (default 0); blank → null unless required. */
function numMin(raw, field, min = 0, { required = false, max = 1e9 } = {}) {
  if (isBlank(raw)) return required ? { error: `${field} is required` } : { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${field} must be a number of at least ${min}` };
  return { value: n };
}

/** Trimmed text up to maxLen; blank → null unless required. */
function text(raw, field, maxLen = 2000, { required = false } = {}) {
  if (isBlank(raw) || (typeof raw === 'string' && !raw.trim())) {
    return required ? { error: `${field} is required` } : { value: null };
  }
  if (typeof raw !== 'string') return { error: `${field} must be text` };
  const t = raw.trim();
  if (t.length > maxLen) return { error: `${field} must be at most ${maxLen} characters` };
  return { value: t };
}

/** One of a fixed list; blank → null unless required. */
function oneOf(raw, field, allowed, { required = false } = {}) {
  if (isBlank(raw)) return required ? { error: `${field} is required` } : { value: null };
  if (!allowed.includes(raw)) return { error: `${field} must be one of: ${allowed.join(', ')}` };
  return { value: raw };
}

/** Calendar date "YYYY-MM-DD" (a real date); blank → null unless required. */
function dateStr(raw, field, { required = false } = {}) {
  if (isBlank(raw)) return required ? { error: `${field} is required` } : { value: null };
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: `${field} must be a date (YYYY-MM-DD)` };
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return { error: `${field} is not a real date` };
  return { value: raw };
}

/** Clock time "HH:MM" or "HH:MM:SS" (24 h); blank → null. */
function clockTime(raw, field) {
  if (isBlank(raw)) return { value: null };
  const m = typeof raw === 'string' && raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return { error: `${field} must be a time like 07:30 (24-hour)` };
  return { value: `${m[1]}:${m[2]}:${m[3] || '00'}` };
}

/** Boolean (true/false only); blank → null. */
function bool(raw, field) {
  if (isBlank(raw)) return { value: null };
  if (raw !== true && raw !== false) return { error: `${field} must be true or false` };
  return { value: raw };
}

/** http(s) link; blank → null. */
function url(raw, field) {
  const t = text(raw, field, 2000);
  if (t.error || t.value === null) return t;
  try {
    const u = new URL(t.value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: `${field} must start with http:// or https://` };
  } catch (_) {
    return { error: `${field} must be a full link (https://...)` };
  }
  return t;
}

/** Program color: "#RRGGBB"; blank → null. */
function hexColor(raw, field = 'color') {
  if (isBlank(raw)) return { value: null };
  if (typeof raw !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(raw)) return { error: `${field} must be a hex color like #3B82F6` };
  return { value: raw.toUpperCase() };
}

/** A 400 error a controller's catch can recognise (err.statusCode). */
function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/** Throws a 400 when a validator result carries an error; else returns its value. */
function take(result) {
  if (result.error) throw badRequest(result.error);
  return result.value;
}

// RPE target: 1 to 11 (RPE 11 is supported app-wide since migration 034).
const rpeTarget = (raw, field = 'target_rpe') => intIn(raw, field, 1, 11);

// Micro progressive overload (data only, Phase 1A-1). Stored as JSONB so the
// owner's idea can grow by adding a key here, with no migration.
const MICRO_OVERLOAD_KEYS = {
  type: v => oneOf(v, 'micro_overload.type', ['reps', 'weight', 'time', 'distance'], { required: true }),
  step: v => numMin(v, 'micro_overload.step', 0, { required: true }),
  unit: v => text(v, 'micro_overload.unit', 20),
  frequency: v => oneOf(v, 'micro_overload.frequency', ['session', 'week']),
  cap: v => numMin(v, 'micro_overload.cap', 0),
};
function microOverload(raw) {
  if (isBlank(raw)) return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'micro_overload must be an object' };
  const unknown = Object.keys(raw).filter(k => !(k in MICRO_OVERLOAD_KEYS));
  if (unknown.length) {
    return { error: `micro_overload has unknown field(s): ${unknown.join(', ')}. Allowed: ${Object.keys(MICRO_OVERLOAD_KEYS).join(', ')}` };
  }
  const out = {};
  for (const [k, check] of Object.entries(MICRO_OVERLOAD_KEYS)) {
    const r = check(raw[k]);
    if (r.error) return r;
    if (r.value !== null) out[k] = r.value;
  }
  if (out.step === 0) return { error: 'micro_overload.step must be more than 0' };
  return { value: out };
}

module.exports = {
  isBlank, intIn, numMin, text, oneOf, dateStr, clockTime, bool, url, hexColor,
  badRequest, take, rpeTarget, microOverload, MICRO_OVERLOAD_KEYS,
};
