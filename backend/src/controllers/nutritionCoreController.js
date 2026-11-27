// backend/src/controllers/nutritionCoreController.js
// Phase 1B-1: my foods, saved foods, nutrients, nutrient goals, settings, BMR.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { nutrientList, mergedNutrients, goalStatus } = require('../utils/nutritionCore');

function fail(res, err, what) {
  if ([400, 404, 409].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const notFound = what => Object.assign(new Error(`${what} not found`), { statusCode: 404 });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

// ── My foods ──────────────────────────────────────────────────────────────────
// A "my food" is a foods row the user created (created_by_user_id), the same
// structure POST /nutrition/foods/custom has always used.

const FOOD_FIELDS = {
  name: v => V.text(v, 'name', 255, { required: true }),
  brand: v => V.text(v, 'brand', 255),
  description: v => V.text(v, 'description', 2000),
  serving_size: v => V.numMin(v, 'serving_size', 0.01, { max: 100000 }),
  serving_unit: v => V.oneOf(v, 'serving_unit', ['g', 'ml', 'oz', 'lb', 'kg']),
  calories_per_100g: v => V.numMin(v, 'calories_per_100g', 0, { required: true, max: 900 }),
  protein_per_100g: v => V.numMin(v, 'protein_per_100g', 0, { max: 100 }),
  carbs_per_100g: v => V.numMin(v, 'carbs_per_100g', 0, { max: 100 }),
  fat_per_100g: v => V.numMin(v, 'fat_per_100g', 0, { max: 100 }),
  fiber_per_100g: v => V.numMin(v, 'fiber_per_100g', 0, { max: 100 }),
  sugar_per_100g: v => V.numMin(v, 'sugar_per_100g', 0, { max: 100 }),
  sodium_per_100g: v => V.numMin(v, 'sodium_per_100g', 0, { max: 9999 }),
};
// NOT NULL macro columns default to 0, as createCustomFood does.
const ZERO_DEFAULT = new Set(['protein_per_100g', 'carbs_per_100g', 'fat_per_100g']);

/** Extra nutrients { key: amount_per_100g | null } (only keys without a foods column). */
async function extraNutrients(db, raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw V.badRequest('nutrients must be an object like { "potassium": 350 }');
  const list = await nutrientList(db);
  const byKey = Object.fromEntries(list.map(n => [n.key, n]));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!byKey[k]) throw V.badRequest(`Unknown nutrient: ${k}`);
    if (byKey[k].food_column) throw V.badRequest(`${k} is stored in the food's own ${byKey[k].food_column} field; set that instead`);
    out[k] = v === null ? null : V.take(V.numMin(v, `nutrients.${k}`, 0, { max: 1000000 }));
  }
  return out;
}

async function writeExtras(db, foodId, extras) {
  if (!extras) return;
  for (const [k, v] of Object.entries(extras)) {
    if (v === null) await db.query(`DELETE FROM food_nutrients WHERE food_id = $1 AND nutrient_key = $2`, [foodId, k]);
    else {
      await db.query(
        `INSERT INTO food_nutrients (food_id, nutrient_key, amount_per_100g) VALUES ($1,$2,$3)
         ON CONFLICT (food_id, nutrient_key) DO UPDATE SET amount_per_100g = EXCLUDED.amount_per_100g`,
        [foodId, k, v]
      );
    }
  }
}

async function ownFood(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT * FROM foods WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL`, [n, uid]);
  return r.rows[0] || null;
}

async function foodOut(db, food, uid) {
  const saved = await db.query(`SELECT 1 FROM saved_foods WHERE user_id = $1 AND food_id = $2`, [uid, food.id]);
  return { ...food, saved: saved.rows.length > 0, nutrients: await mergedNutrients(db, food) };
}

// GET /nutrition/my-foods
const listMyFoods = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.*, (sf.food_id IS NOT NULL) AS saved FROM foods f
       LEFT JOIN saved_foods sf ON sf.food_id = f.id AND sf.user_id = $1
       WHERE f.created_by_user_id = $1 AND f.archived_at IS NULL ORDER BY lower(f.name), f.id`,
      [req.user.userId]
    );
    res.json({ foods: r.rows });
  } catch (err) { fail(res, err, 'list my foods'); }
};

// GET /nutrition/my-foods/:id
const getMyFood = async (req, res) => {
  try {
    const f = await ownFood(pool, req.params.id, req.user.userId);
    if (!f) throw notFound('Food');
    res.json({ food: await foodOut(pool, f, req.user.userId) });
  } catch (err) { fail(res, err, 'get food'); }
};

// POST /nutrition/my-foods  { name, calories_per_100g, ...columns, nutrients? }
const createMyFood = async (req, res) => {
  const uid = req.user.userId;
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const f = {};
    for (const [k, check] of Object.entries(FOOD_FIELDS)) {
      if (k in b || ['name', 'calories_per_100g'].includes(k)) f[k] = V.take(check(b[k]));
    }
    for (const k of ZERO_DEFAULT) if (f[k] === undefined || f[k] === null) f[k] = 0;
    if (f.serving_size === undefined || f.serving_size === null) f.serving_size = 100;
    if (!f.serving_unit) f.serving_unit = 'g';
    const extras = await extraNutrients(client, b.nutrients);
    await client.query('BEGIN');
    const cols = Object.keys(f);
    const r = await client.query(
      `INSERT INTO foods (${cols.join(', ')}, source, created_by_user_id, is_verified, is_custom)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, 'custom', $${cols.length + 1}, false, true) RETURNING *`,
      [...Object.values(f), uid]
    );
    await writeExtras(client, r.rows[0].id, extras);
    await client.query('COMMIT');
    res.status(201).json({ food: await foodOut(pool, r.rows[0], uid) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'create food');
  } finally { client.release(); }
};

// PUT /nutrition/my-foods/:id  (only keys sent change; already-logged entries keep their stored values)
const updateMyFood = async (req, res) => {
  const uid = req.user.userId;
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const f = {};
    for (const [k, check] of Object.entries(FOOD_FIELDS)) if (k in b) f[k] = V.take(check(b[k]));
    for (const k of ZERO_DEFAULT) if (k in f && f[k] === null) f[k] = 0;
    const extras = await extraNutrients(client, b.nutrients);
    await client.query('BEGIN');
    const food = await ownFood(client, req.params.id, uid);
    if (!food) throw notFound('Food');
    const keys = Object.keys(f);
    if (keys.length) {
      await client.query(
        `UPDATE foods SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
        [...Object.values(f), food.id]
      );
    }
    await writeExtras(client, food.id, extras);
    await client.query('COMMIT');
    res.json({ food: await foodOut(pool, await ownFood(pool, food.id, uid), uid) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err, 'update food');
  } finally { client.release(); }
};

// DELETE /nutrition/my-foods/:id — archived when it is used anywhere (logged
// meals would otherwise be deleted by the existing cascade), else deleted.
const deleteMyFood = async (req, res) => {
  try {
    const food = await ownFood(pool, req.params.id, req.user.userId);
    if (!food) throw notFound('Food');
    const used = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM meal_foods WHERE food_id = $1)
           OR EXISTS (SELECT 1 FROM meal_template_items WHERE food_id = $1)
           OR EXISTS (SELECT 1 FROM recipe_ingredients WHERE food_id = $1) AS used`,
      [food.id]
    );
    if (used.rows[0].used) {
      await pool.query(`UPDATE foods SET archived_at = NOW() WHERE id = $1`, [food.id]);
      return res.json({ id: food.id, result: 'archived', message: 'This food is in your log or templates, so it was archived (hidden from your foods and search) instead of deleted.' });
    }
    await pool.query(`DELETE FROM foods WHERE id = $1`, [food.id]);
    res.json({ id: food.id, result: 'deleted' });
  } catch (err) { fail(res, err, 'delete food'); }
};

// ── Saved foods ───────────────────────────────────────────────────────────────

// GET /nutrition/saved-foods
const listSavedFoods = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.*, sf.created_at AS saved_at FROM saved_foods sf JOIN foods f ON f.id = sf.food_id
       WHERE sf.user_id = $1 AND f.archived_at IS NULL ORDER BY sf.created_at DESC`,
      [req.user.userId]
    );
    res.json({ foods: r.rows });
  } catch (err) { fail(res, err, 'list saved foods'); }
};

/** A food the user may see: any public food, or their own (archived ones are hidden). */
async function visibleFood(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(
    `SELECT * FROM foods WHERE id = $1 AND archived_at IS NULL
       AND (created_by_user_id IS NULL OR created_by_user_id = $2 OR source <> 'custom')`,
    [n, uid]
  );
  return r.rows[0] || null;
}

// PUT /nutrition/saved-foods/:foodId
const saveFood = async (req, res) => {
  try {
    const food = await visibleFood(pool, req.params.foodId, req.user.userId);
    if (!food) throw notFound('Food');
    await pool.query(`INSERT INTO saved_foods (user_id, food_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.userId, food.id]);
    res.json({ food_id: food.id, saved: true });
  } catch (err) { fail(res, err, 'save food'); }
};

// DELETE /nutrition/saved-foods/:foodId
const unsaveFood = async (req, res) => {
  try {
    const n = idOf(req.params.foodId);
    const r = n && await pool.query(`DELETE FROM saved_foods WHERE user_id = $1 AND food_id = $2 RETURNING food_id`, [req.user.userId, n]);
    if (!r || !r.rows.length) throw notFound('Saved food');
    res.json({ food_id: n, saved: false });
  } catch (err) { fail(res, err, 'unsave food'); }
};

// ── Nutrients ─────────────────────────────────────────────────────────────────

// GET /nutrition/nutrients
const listNutrients = async (req, res) => {
  try { res.json({ nutrients: await nutrientList(pool) }); } catch (err) { fail(res, err, 'list nutrients'); }
};

// GET /nutrition/foods/:id/nutrients — the food's columns merged with its extra nutrients
const getFoodNutrients = async (req, res) => {
  try {
    const food = await visibleFood(pool, req.params.id, req.user.userId);
    if (!food) throw notFound('Food');
    res.json({ food_id: food.id, per: '100g', nutrients: await mergedNutrients(pool, food) });
  } catch (err) { fail(res, err, 'get nutrients'); }
};

// PUT /nutrition/foods/:id/nutrients  { nutrients: { key: amount | null } } — own foods (or any food for an admin)
const putFoodNutrients = async (req, res) => {
  const uid = req.user.userId;
  try {
    const extras = await extraNutrients(pool, req.body?.nutrients ?? {});
    if (!Object.keys(extras).length) throw V.badRequest('nutrients must name at least one nutrient');
    const n = idOf(req.params.id);
    const admin = (await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [uid])).rows[0]?.is_admin;
    const r = n && await pool.query(
      `SELECT * FROM foods WHERE id = $1 AND archived_at IS NULL AND (created_by_user_id = $2 OR $3::boolean)`, [n, uid, !!admin]
    );
    if (!r || !r.rows.length) throw notFound('Food');
    await writeExtras(pool, n, extras);
    res.json({ food_id: n, per: '100g', nutrients: await mergedNutrients(pool, r.rows[0]) });
  } catch (err) { fail(res, err, 'save nutrients'); }
};

// ── Nutrient goals ────────────────────────────────────────────────────────────

const PERCENT_KEYS = ['protein', 'carbohydrate', 'fat', 'alcohol'];

async function goalFields(db, b) {
  const list = await nutrientList(db);
  const key = V.take(V.text(b.nutrient_key, 'nutrient_key', 50, { required: true }));
  if (!list.some(n => n.key === key)) throw V.badRequest(`Unknown nutrient: ${key}`);
  const g = {
    nutrient_key: key,
    period: V.take(V.oneOf(b.period ?? 'daily', 'period', ['daily', 'weekly'], { required: true })),
    direction: V.take(V.oneOf(b.direction, 'direction', ['at_least', 'at_most', 'range'], { required: true })),
    mode: V.take(V.oneOf(b.mode ?? 'amount', 'mode', ['amount', 'percent_calories'], { required: true })),
    target: V.take(V.numMin(b.target, 'target', 0, { max: 10000000 })),
    min_value: V.take(V.numMin(b.min_value, 'min_value', 0, { max: 10000000 })),
    max_value: V.take(V.numMin(b.max_value, 'max_value', 0, { max: 10000000 })),
    soft_limit: V.take(V.numMin(b.soft_limit, 'soft_limit', 0, { max: 10000000 })),
    hard_limit: V.take(V.numMin(b.hard_limit, 'hard_limit', 0, { max: 10000000 })),
    is_active: V.take(V.bool(b.is_active, 'is_active')) ?? true,
  };
  if (g.mode === 'percent_calories') {
    if (!PERCENT_KEYS.includes(key)) throw V.badRequest(`A percent-of-calories goal works for ${PERCENT_KEYS.join(', ')} only`);
    for (const k of ['target', 'min_value', 'max_value', 'soft_limit', 'hard_limit']) {
      if (g[k] !== null && g[k] > 100) throw V.badRequest(`${k} is a percent of calories (0 to 100)`);
    }
  }
  if (g.direction !== 'range' && g.target === null) throw V.badRequest(`An ${g.direction} goal needs a target`);
  if (g.direction === 'range' && g.min_value === null && g.max_value === null && g.target === null) {
    throw V.badRequest('A range goal needs min_value and/or max_value');
  }
  if (g.min_value !== null && g.max_value !== null && g.max_value < g.min_value) throw V.badRequest('max_value must be at least min_value');
  if (g.soft_limit !== null && g.hard_limit !== null && g.hard_limit < g.soft_limit) throw V.badRequest('hard_limit must be at least soft_limit');
  return g;
}

// GET /nutrition/nutrient-goals
const listGoals = async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM nutrient_goals WHERE user_id = $1 ORDER BY period, nutrient_key`, [req.user.userId]);
    res.json({ goals: r.rows });
  } catch (err) { fail(res, err, 'list goals'); }
};

// PUT /nutrition/nutrient-goals  — create or replace the goal for (nutrient_key, period)
const putGoal = async (req, res) => {
  try {
    const g = await goalFields(pool, req.body || {});
    const cols = Object.keys(g);
    const r = await pool.query(
      `INSERT INTO nutrient_goals (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id, nutrient_key, period) DO UPDATE SET
         ${cols.filter(c => !['nutrient_key', 'period'].includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()
       RETURNING *, (xmax = 0) AS inserted`,
      [req.user.userId, ...Object.values(g)]
    );
    const { inserted, ...goal } = r.rows[0];
    res.status(inserted ? 201 : 200).json({ goal });
  } catch (err) { fail(res, err, 'save goal'); }
};

// DELETE /nutrition/nutrient-goals/:id
const deleteGoal = async (req, res) => {
  try {
    const n = idOf(req.params.id);
    const r = n && await pool.query(`DELETE FROM nutrient_goals WHERE id = $1 AND user_id = $2 RETURNING id`, [n, req.user.userId]);
    if (!r || !r.rows.length) throw notFound('Goal');
    res.json({ message: 'Goal deleted' });
  } catch (err) { fail(res, err, 'delete goal'); }
};

// GET /nutrition/goal-status?date=YYYY-MM-DD — actual vs goal, with warnings (never blocking)
const getGoalStatus = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.query.date, 'date', { required: true }));
    res.json(await goalStatus(pool, req.user.userId, date));
  } catch (err) { fail(res, err, 'get goal status'); }
};

// ── Settings: diet type, BMR formula, threshold ───────────────────────────────

const DIET_PRESETS = {
  standard: { label: 'Standard', macro_percent: { carbohydrate: 50, protein: 20, fat: 30 } },
  vegetarian: { label: 'Vegetarian', macro_percent: { carbohydrate: 50, protein: 20, fat: 30 }, excludes: ['meat', 'poultry', 'fish', 'seafood'] },
  vegan: { label: 'Vegan', macro_percent: { carbohydrate: 55, protein: 18, fat: 27 }, excludes: ['meat', 'poultry', 'fish', 'seafood', 'dairy', 'eggs', 'honey'] },
  keto: { label: 'Keto', macro_percent: { carbohydrate: 5, protein: 20, fat: 75 } },
  low_carb: { label: 'Low carb', macro_percent: { carbohydrate: 25, protein: 30, fat: 45 } },
  high_protein: { label: 'High protein', macro_percent: { carbohydrate: 35, protein: 35, fat: 30 } },
  custom: { label: 'Custom (your own definition in diet_custom)' },
};
const BMR_FORMULAS = ['mifflin_st_jeor', 'harris_benedict', 'katch_mcardle'];

async function settingsOut(db, uid) {
  const u = (await db.query(
    `SELECT diet_type, diet_custom, bmr_formula, overconsumption_threshold_pct::float AS overconsumption_threshold_pct,
            water_goal_oz::float AS water_goal_oz, water_preset_oz::float AS water_preset_oz FROM users WHERE id = $1`, [uid]
  )).rows[0];
  return { ...u, diet_presets: DIET_PRESETS, bmr_formulas: BMR_FORMULAS };
}

// GET /nutrition/settings
const getSettings = async (req, res) => {
  try { res.json(await settingsOut(pool, req.user.userId)); } catch (err) { fail(res, err, 'get nutrition settings'); }
};

// PUT /nutrition/settings  { diet_type?, diet_custom?, bmr_formula?, overconsumption_threshold_pct? }
const putSettings = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const f = {};
    if ('diet_type' in b) f.diet_type = V.take(V.oneOf(b.diet_type, 'diet_type', Object.keys(DIET_PRESETS), { required: true }));
    if ('diet_custom' in b) {
      const c = b.diet_custom;
      if (c !== null) {
        if (typeof c !== 'object' || Array.isArray(c)) throw V.badRequest('diet_custom must be an object like { "name": "...", "macro_percent": {...} }');
        const name = V.take(V.text(c.name, 'diet_custom.name', 60, { required: true }));
        const out = { name, description: V.take(V.text(c.description, 'diet_custom.description', 1000)) };
        if (c.macro_percent !== undefined && c.macro_percent !== null) {
          const mp = {};
          for (const k of ['carbohydrate', 'protein', 'fat']) mp[k] = V.take(V.numMin(c.macro_percent[k], `diet_custom.macro_percent.${k}`, 0, { required: true, max: 100 }));
          if (Math.round(mp.carbohydrate + mp.protein + mp.fat) !== 100) throw V.badRequest('diet_custom.macro_percent must add up to 100');
          out.macro_percent = mp;
        }
        if (Array.isArray(c.excludes)) out.excludes = c.excludes.slice(0, 50).map(x => V.take(V.text(x, 'diet_custom.excludes', 50, { required: true })));
        f.diet_custom = JSON.stringify(out);
      } else f.diet_custom = null;
    }
    if ('bmr_formula' in b) f.bmr_formula = V.take(V.oneOf(b.bmr_formula, 'bmr_formula', BMR_FORMULAS, { required: true }));
    if ('overconsumption_threshold_pct' in b) {
      f.overconsumption_threshold_pct = V.take(V.numMin(b.overconsumption_threshold_pct, 'overconsumption_threshold_pct', 0, { required: true, max: 100 }));
    }
    const cur = (await pool.query(`SELECT diet_type, diet_custom FROM users WHERE id = $1`, [uid])).rows[0];
    const nextType = f.diet_type ?? cur.diet_type;
    const nextCustom = 'diet_custom' in f ? f.diet_custom : cur.diet_custom;
    if (nextType === 'custom' && !nextCustom) throw V.badRequest('A custom diet needs diet_custom ({ "name": ... })');
    const keys = Object.keys(f);
    if (keys.length) {
      await pool.query(`UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...Object.values(f), uid]);
    }
    res.json(await settingsOut(pool, uid));
  } catch (err) { fail(res, err, 'save nutrition settings'); }
};

// ── BMR ───────────────────────────────────────────────────────────────────────

function sexOf(g) {
  const s = String(g || '').trim().toLowerCase();
  if (['male', 'm', 'man'].includes(s)) return 'male';
  if (['female', 'f', 'woman'].includes(s)) return 'female';
  return null;
}
function ageOn(dob, today = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

/**
 * BMR in kcal/day.
 *   Mifflin-St Jeor: 10w + 6.25h - 5a + 5 (male) / - 161 (female)
 *   Harris-Benedict (Roza & Shizgal 1984): male 88.362 + 13.397w + 4.799h - 5.677a;
 *                                          female 447.593 + 9.247w + 3.098h - 4.330a
 *   Katch-McArdle: 370 + 21.6 × lean mass (kg), lean = w × (1 - bf/100)
 * w kg, h cm, a years. With no male/female value, the two results are averaged (with a warning).
 */
function computeBmr({ formula, weight_kg: w, height_cm: h, age: a, sex, body_fat_pct: bf }) {
  const warnings = [];
  let used = formula;
  if (formula === 'katch_mcardle' && (bf === null || bf === undefined)) {
    used = 'mifflin_st_jeor';
    warnings.push('Katch-McArdle needs your body fat %, which is not set. Mifflin-St Jeor was used instead.');
  }
  if (used === 'katch_mcardle') {
    return { formula_used: used, bmr_kcal: Math.round((370 + 21.6 * (w * (1 - bf / 100))) * 10) / 10, warnings };
  }
  const calc = s => (used === 'mifflin_st_jeor'
    ? 10 * w + 6.25 * h - 5 * a + (s === 'male' ? 5 : -161)
    : s === 'male' ? 88.362 + 13.397 * w + 4.799 * h - 5.677 * a : 447.593 + 9.247 * w + 3.098 * h - 4.330 * a);
  let v;
  if (sex) v = calc(sex);
  else {
    v = (calc('male') + calc('female')) / 2;
    warnings.push('Sex is not set to male or female, so the average of the male and female formulas is shown.');
  }
  return { formula_used: used, bmr_kcal: Math.round(v * 10) / 10, warnings };
}

// GET /nutrition/bmr?formula=&weight_kg=&height_cm=&age=&sex=&body_fat_pct=
// Missing inputs come from the profile (weight_kg, height_cm, date_of_birth,
// gender) and the body-fat settings goal (current_bf).
const getBmr = async (req, res) => {
  try {
    const q = req.query;
    const u = (await pool.query(`SELECT weight_kg, height_cm, date_of_birth, gender, goals, bmr_formula FROM users WHERE id = $1`, [req.user.userId])).rows[0];
    const formula = V.take(V.oneOf(q.formula, 'formula', BMR_FORMULAS)) || u.bmr_formula || 'mifflin_st_jeor';
    const weight = V.take(V.numMin(q.weight_kg, 'weight_kg', 20, { max: 400 })) ?? (u.weight_kg !== null ? Number(u.weight_kg) : null);
    const height = V.take(V.numMin(q.height_cm, 'height_cm', 50, { max: 260 })) ?? (u.height_cm !== null ? Number(u.height_cm) : null);
    const age = V.take(V.intIn(q.age, 'age', 10, 120)) ?? ageOn(u.date_of_birth);
    const sex = q.sex !== undefined ? V.take(V.oneOf(q.sex, 'sex', ['male', 'female'])) : sexOf(u.gender);
    const goalBf = (Array.isArray(u.goals) ? u.goals : []).find(g => g?.type === 'body_fat')?.details?.current_bf;
    const bfRaw = q.body_fat_pct !== undefined ? q.body_fat_pct : goalBf;
    const bf = bfRaw === undefined || bfRaw === null || bfRaw === '' ? null : V.take(V.numMin(bfRaw, 'body_fat_pct', 2, { max: 70 }));
    const missing = [];
    if (weight === null) missing.push('weight_kg');
    const needsHA = !(formula === 'katch_mcardle' && bf !== null);
    if (needsHA && height === null) missing.push('height_cm');
    if (needsHA && age === null) missing.push('age');
    if (missing.length) throw V.badRequest(`Missing ${missing.join(', ')} (send it, or set it in your profile)`);
    const r = computeBmr({ formula, weight_kg: weight, height_cm: height, age, sex, body_fat_pct: bf });
    res.json({ formula_requested: formula, ...r, inputs: { weight_kg: weight, height_cm: height, age, sex, body_fat_pct: bf } });
  } catch (err) { fail(res, err, 'calculate BMR'); }
};

module.exports = {
  listMyFoods, getMyFood, createMyFood, updateMyFood, deleteMyFood, listSavedFoods, saveFood, unsaveFood,
  listNutrients, getFoodNutrients, putFoodNutrients, listGoals, putGoal, deleteGoal, getGoalStatus,
  getSettings, putSettings, getBmr, computeBmr, DIET_PRESETS, visibleFood,
};
