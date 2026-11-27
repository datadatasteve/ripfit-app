// Nutrition helpers (Phase 1B-1): units, merged nutrients, day totals, goal checks.
//
// Nutrients: the existing foods columns stay authoritative for what they hold
// (nutrients.food_column); food_nutrients holds every other nutrient. All
// values are per 100 g (or 100 ml), like the foods columns.

// Same conversion the existing meal logging uses (nutritionController).
const UNIT_TO_GRAMS = { g: 1, ml: 1, oz: 28.3495, lb: 453.592, kg: 1000 };
const gramsOf = (size, unit) => Number(size) * (UNIT_TO_GRAMS[unit] || 1);

let nutrientCache = null;
async function nutrientList(db) {
  if (!nutrientCache) {
    const r = await db.query(`SELECT key, name, unit, category, sort_order, food_column FROM nutrients ORDER BY sort_order, key`);
    nutrientCache = r.rows;
  }
  return nutrientCache;
}

/** { key: amount_per_100g } for one food row, merging its columns and food_nutrients. */
async function mergedNutrients(db, food) {
  const list = await nutrientList(db);
  const out = {};
  for (const n of list) {
    if (n.food_column && food[n.food_column] !== null && food[n.food_column] !== undefined) {
      out[n.key] = { amount: Number(food[n.food_column]), source: 'food_column' };
    }
  }
  const extra = await db.query(`SELECT nutrient_key, amount_per_100g FROM food_nutrients WHERE food_id = $1`, [food.id]);
  for (const e of extra.rows) {
    if (!out[e.nutrient_key]) out[e.nutrient_key] = { amount: Number(e.amount_per_100g), source: 'food_nutrients' };
  }
  return list.filter(n => out[n.key]).map(n => ({
    key: n.key, name: n.name, unit: n.unit, category: n.category, amount_per_100g: out[n.key].amount, source: out[n.key].source,
  }));
}

/**
 * Totals of every nutrient a user logged between two dates (inclusive).
 * energy / protein / carbohydrate / fat / fiber come from the stored
 * meal_foods values (exactly what the day view and daily summary show); the
 * other nutrients are computed from each food's per-100 g values × grams.
 */
async function nutrientTotals(db, userId, from, to) {
  const list = await nutrientList(db);
  const rows = await db.query(
    `SELECT f.*, mf.calories, mf.protein, mf.carbs, mf.fat, mf.fiber, mf.serving_size AS logged_size, mf.serving_unit AS logged_unit
     FROM meals m JOIN meal_foods mf ON mf.meal_id = m.id JOIN foods f ON f.id = mf.food_id
     WHERE m.user_id = $1 AND m.meal_date BETWEEN $2 AND $3`,
    [userId, from, to]
  );
  const totals = Object.fromEntries(list.map(n => [n.key, 0]));
  const STORED = { energy: 'calories', protein: 'protein', carbohydrate: 'carbs', fat: 'fat', fiber: 'fiber' };
  const foodIds = [...new Set(rows.rows.map(r => r.id))];
  const extras = foodIds.length
    ? (await db.query(`SELECT food_id, nutrient_key, amount_per_100g FROM food_nutrients WHERE food_id = ANY($1::int[])`, [foodIds])).rows
    : [];
  for (const r of rows.rows) {
    const factor = gramsOf(r.logged_size, r.logged_unit) / 100;
    for (const n of list) {
      if (STORED[n.key]) { totals[n.key] += Number(r[STORED[n.key]] || 0); continue; }
      let per100 = null;
      if (n.food_column && r[n.food_column] !== null && r[n.food_column] !== undefined) per100 = Number(r[n.food_column]);
      else {
        const e = extras.find(x => x.food_id === r.id && x.nutrient_key === n.key);
        if (e) per100 = Number(e.amount_per_100g);
      }
      if (per100 !== null) totals[n.key] += per100 * factor;
    }
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
  return totals;
}

const KCAL_PER_GRAM = { protein: 4, carbohydrate: 4, fat: 9, alcohol: 7 };

/**
 * Evaluates goals against totals. Returns one status per goal with warnings.
 * Warnings never block anything. Levels:
 *   over_threshold — more than threshold% above the goal's upper bound (target / max)
 *   soft_limit     — at or above the soft limit
 *   hard_limit     — at or above the hard limit (the strongest)
 *   below_minimum  — an at_least / range goal not reached (informational)
 */
function evaluateGoals(goals, totals, thresholdPct, { finalPeriod = false } = {}) {
  const nutrientsMeta = goals._meta || {};
  return goals.map(g => {
    let actual = totals[g.nutrient_key] ?? 0;
    let unit = nutrientsMeta[g.nutrient_key]?.unit || null;
    if (g.mode === 'percent_calories') {
      const kcal = totals.energy || 0;
      actual = kcal > 0 ? Math.round(((totals[g.nutrient_key] || 0) * (KCAL_PER_GRAM[g.nutrient_key] || 0) / kcal) * 1000) / 10 : 0;
      unit = '% of calories';
    }
    const num = v => (v === null || v === undefined ? null : Number(v));
    const target = num(g.target); const min = num(g.min_value); const max = num(g.max_value);
    const upper = g.direction === 'at_most' ? (target ?? max) : g.direction === 'range' ? (max ?? target) : null;
    const lower = g.direction === 'at_least' ? (target ?? min) : g.direction === 'range' ? (min ?? null) : null;
    const warnings = [];
    if (upper !== null && actual > upper * (1 + Number(thresholdPct) / 100)) {
      warnings.push({ level: 'over_threshold', message: `More than ${Number(thresholdPct)}% over your ${g.nutrient_key} goal (${upper} ${unit}).` });
    }
    const soft = num(g.soft_limit); const hard = num(g.hard_limit);
    if (hard !== null && actual >= hard) {
      warnings.push({ level: 'hard_limit', message: `You have reached your hard limit for ${g.nutrient_key} (${hard} ${unit}).` });
    } else if (soft !== null && actual >= soft) {
      warnings.push({ level: 'soft_limit', message: `You have passed your soft limit for ${g.nutrient_key} (${soft} ${unit}).` });
    }
    if (finalPeriod && lower !== null && actual < lower) {
      warnings.push({ level: 'below_minimum', message: `Below your ${g.nutrient_key} goal (${lower} ${unit}).` });
    }
    const met = (lower === null || actual >= lower) && (upper === null || actual <= upper);
    return { goal_id: g.id, nutrient_key: g.nutrient_key, period: g.period, direction: g.direction, mode: g.mode, unit, actual, target, min_value: min, max_value: max, soft_limit: soft, hard_limit: hard, met, warnings };
  });
}

/** Monday of the week (YYYY-MM-DD) for a date. */
function weekStart(d) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Goal status for a date: daily goals for that day, weekly goals for its Monday-Sunday week. */
async function goalStatus(db, userId, date) {
  const goals = (await db.query(`SELECT * FROM nutrient_goals WHERE user_id = $1 AND is_active ORDER BY id`, [userId])).rows;
  const u = await db.query(`SELECT overconsumption_threshold_pct FROM users WHERE id = $1`, [userId]);
  const threshold = Number(u.rows[0]?.overconsumption_threshold_pct ?? 10);
  const list = await nutrientList(db);
  const meta = Object.fromEntries(list.map(n => [n.key, n]));
  const day = goals.filter(g => g.period === 'daily');
  const week = goals.filter(g => g.period === 'weekly');
  const ws = weekStart(date);
  const [dayTotals, weekTotals] = await Promise.all([
    day.length ? nutrientTotals(db, userId, date, date) : {},
    week.length ? nutrientTotals(db, userId, ws, addDays(ws, 6)) : {},
  ]);
  day._meta = meta; week._meta = meta;
  return {
    date, week_start: ws, week_end: addDays(ws, 6), overconsumption_threshold_pct: threshold,
    goals: [...evaluateGoals(day, dayTotals, threshold), ...evaluateGoals(week, weekTotals, threshold)],
  };
}

module.exports = { UNIT_TO_GRAMS, gramsOf, nutrientList, mergedNutrients, nutrientTotals, evaluateGoals, goalStatus, weekStart, addDays, KCAL_PER_GRAM };
