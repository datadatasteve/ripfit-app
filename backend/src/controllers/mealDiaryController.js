// backend/src/controllers/mealDiaryController.js
// Phase 1B-1: meals per day, the meal diary (log now, choose the meal later),
// the day API, meal templates, copy a day, and water.
//
// Meal slots: a user has 1-8 named meals (user_meal_slots); none saved = the
// default four (Breakfast, Lunch, Dinner, Snacks). A logged meals row belongs
// to slot meal_slot, or, for rows logged before 1B-1, to the slot its
// meal_type maps to (breakfast 1, lunch 2, dinner 3, snack/snacks 4). New rows
// keep a meal_type the existing screen understands (slots 1-4 → breakfast,
// lunch, dinner, snacks; 5-8 → other). Unassigned diary entries are rows with
// unassigned = true and meal_type 'other': they count in daily totals.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { gramsOf, goalStatus } = require('../utils/nutritionCore');

const DEFAULT_SLOTS = [
  { slot_number: 1, name: 'Breakfast', target_time: null },
  { slot_number: 2, name: 'Lunch', target_time: null },
  { slot_number: 3, name: 'Dinner', target_time: null },
  { slot_number: 4, name: 'Snacks', target_time: null },
];
const SLOT_TYPE = { 1: 'breakfast', 2: 'lunch', 3: 'dinner', 4: 'snacks' };
const TYPE_SLOT = { breakfast: 1, lunch: 2, dinner: 3, snack: 4, snacks: 4 };
// SQL: the effective slot of a meals row m
const EFFECTIVE_SLOT = (m) => `COALESCE(${m}.meal_slot, CASE ${m}.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 WHEN 'snack' THEN 4 WHEN 'snacks' THEN 4 END)`;

function fail(res, err, what) {
  if ([400, 404, 409].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const r2 = n => Math.round(Number(n) * 100) / 100;

async function tx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

async function slotsOf(db, uid) {
  const r = await db.query(
    `SELECT slot_number, name, to_char(target_time, 'HH24:MI') AS target_time FROM user_meal_slots WHERE user_id = $1 ORDER BY slot_number`, [uid]
  );
  return r.rows.length ? { slots: r.rows, is_default: false } : { slots: DEFAULT_SLOTS, is_default: true };
}

/** A food the user may log: public, or their own (archived foods cannot be newly logged). */
async function loggableFood(db, foodId, uid) {
  const r = await db.query(
    `SELECT * FROM foods WHERE id = $1 AND archived_at IS NULL AND (created_by_user_id IS NULL OR created_by_user_id = $2 OR source <> 'custom')`,
    [foodId, uid]
  );
  return r.rows[0] || null;
}

/** meal_foods values for a serving, with the same maths as the existing logMeal. */
function entryValues(food, size, unit) {
  const mult = gramsOf(size, unit) / 100;
  return {
    calories: food.calories_per_100g * mult, protein: food.protein_per_100g * mult, carbs: food.carbs_per_100g * mult,
    fat: food.fat_per_100g * mult, fiber: (food.fiber_per_100g || 0) * mult,
  };
}

/** The user's meals row for (date, slot), created when missing; or a new unassigned row. */
async function targetMeal(db, uid, date, slot) {
  if (slot === null) {
    const r = await db.query(
      `INSERT INTO meals (user_id, meal_date, meal_type, unassigned) VALUES ($1,$2,'other',TRUE) RETURNING *`, [uid, date]
    );
    return r.rows[0];
  }
  const found = await db.query(
    `SELECT * FROM meals m WHERE m.user_id = $1 AND m.meal_date = $2 AND NOT m.unassigned AND ${EFFECTIVE_SLOT('m')} = $3
     ORDER BY m.id LIMIT 1`,
    [uid, date, slot]
  );
  if (found.rows.length) return found.rows[0];
  const r = await db.query(
    `INSERT INTO meals (user_id, meal_date, meal_type, meal_slot) VALUES ($1,$2,$3,$4) RETURNING *`,
    [uid, date, SLOT_TYPE[slot] || 'other', slot]
  );
  return r.rows[0];
}

async function insertEntry(db, mealId, food, size, unit) {
  const v = entryValues(food, size, unit);
  const r = await db.query(
    `INSERT INTO meal_foods (meal_id, food_id, serving_size, serving_unit, calories, protein, carbs, fat, fiber)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [mealId, food.id, size, unit, v.calories, v.protein, v.carbs, v.fat, v.fiber]
  );
  return r.rows[0];
}

/** Validates a slot number against the user's slots (null = no meal). */
async function slotArg(db, uid, raw, field = 'meal_slot') {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = V.take(V.intIn(raw, field, 1, 8));
  const { slots } = await slotsOf(db, uid);
  if (!slots.some(s => s.slot_number === n)) throw V.badRequest(`${field} ${n} is not one of your meals (you have ${slots.length})`);
  return n;
}

async function warningsFor(uid, date) {
  try {
    const st = await goalStatus(pool, uid, date);
    return st.goals.filter(g => g.warnings.length).map(g => ({ nutrient_key: g.nutrient_key, period: g.period, actual: g.actual, warnings: g.warnings }));
  } catch (e) { console.error('goal warnings skipped:', e.message); return []; }
}

// ── Meal slots ────────────────────────────────────────────────────────────────

// GET /nutrition/meal-slots
const getSlots = async (req, res) => {
  try { res.json(await slotsOf(pool, req.user.userId)); } catch (err) { fail(res, err, 'get meals per day'); }
};

// PUT /nutrition/meal-slots  { slots: [{ name, target_time? (HH:MM) }] } (1-8, in order); { slots: null } = back to the default four
const putSlots = async (req, res) => {
  const uid = req.user.userId;
  try {
    const list = req.body?.slots;
    if (list !== null && !Array.isArray(list)) throw V.badRequest('slots must be a list of { name, target_time? } (1 to 8), or null for the default four');
    if (Array.isArray(list) && (list.length < 1 || list.length > 8)) throw V.badRequest('Choose between 1 and 8 meals');
    const rows = (list || []).map((s, i) => ({
      slot_number: i + 1,
      name: V.take(V.text(s?.name, `slots[${i}].name`, 40, { required: true })),
      target_time: V.take(V.clockTime(s?.target_time, `slots[${i}].target_time`)),
    }));
    await tx(async db => {
      await db.query(`DELETE FROM user_meal_slots WHERE user_id = $1`, [uid]);
      for (const s of rows) {
        await db.query(`INSERT INTO user_meal_slots (user_id, slot_number, name, target_time) VALUES ($1,$2,$3,$4)`, [uid, s.slot_number, s.name, s.target_time]);
      }
    });
    res.json(await slotsOf(pool, uid));
  } catch (err) { fail(res, err, 'save meals per day'); }
};

// ── Day API ───────────────────────────────────────────────────────────────────

async function dayOut(db, uid, date) {
  const { slots, is_default: isDefault } = await slotsOf(db, uid);
  const r = await db.query(
    `SELECT m.id AS meal_id, m.meal_type, m.meal_name, m.unassigned, ${EFFECTIVE_SLOT('m')} AS slot,
            mf.id AS meal_food_id, mf.food_id, f.name AS food_name, f.brand, mf.serving_size::float AS serving_size, mf.serving_unit,
            mf.calories::float AS calories, mf.protein::float AS protein, mf.carbs::float AS carbs, mf.fat::float AS fat, mf.fiber::float AS fiber
     FROM meals m JOIN meal_foods mf ON mf.meal_id = m.id JOIN foods f ON f.id = mf.food_id
     WHERE m.user_id = $1 AND m.meal_date = $2 ORDER BY m.id, mf.id`,
    [uid, date]
  );
  const sum = rows => ['calories', 'protein', 'carbs', 'fat', 'fiber'].reduce((o, k) => ({ ...o, [k]: r2(rows.reduce((s, x) => s + (x[k] || 0), 0)) }), {});
  const entry = x => ({ meal_food_id: x.meal_food_id, meal_id: x.meal_id, meal_type: x.meal_type, food_id: x.food_id, food_name: x.food_name, brand: x.brand,
    serving_size: x.serving_size, serving_unit: x.serving_unit, calories: x.calories, protein: x.protein, carbs: x.carbs, fat: x.fat, fiber: x.fiber });
  const slotNums = new Set(slots.map(s => s.slot_number));
  const unassigned = r.rows.filter(x => x.unassigned);
  const other = r.rows.filter(x => !x.unassigned && !slotNums.has(x.slot));
  const summary = await db.query(
    `SELECT total_calories::float, total_protein::float, total_carbs::float, total_fat::float, total_fiber::float
     FROM daily_nutrition_summary WHERE user_id = $1 AND summary_date = $2`, [uid, date]
  );
  const water = await db.query(`SELECT amount_oz::float AS amount_oz FROM water_logs WHERE user_id = $1 AND log_date = $2`, [uid, date]);
  return {
    date,
    meals_default: isDefault,
    meals: slots.map(s => {
      const rows = r.rows.filter(x => !x.unassigned && x.slot === s.slot_number);
      return { ...s, entries: rows.map(entry), totals: sum(rows) };
    }),
    unassigned: { entries: unassigned.map(entry), totals: sum(unassigned) },
    // Rows logged under a meal the user no longer has (or meal_type 'other'): never dropped.
    other: { entries: other.map(entry), totals: sum(other) },
    totals: sum(r.rows),
    daily_summary: summary.rows[0] || null,
    water_oz: water.rows[0]?.amount_oz ?? null,
  };
}

// GET /nutrition/days/:date
const getDay = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    res.json(await dayOut(pool, req.user.userId, date));
  } catch (err) { fail(res, err, 'get day'); }
};

// ── Meal diary ────────────────────────────────────────────────────────────────

function servingArgs(b, prefix = '') {
  return {
    size: V.take(V.numMin(b.serving_size, `${prefix}serving_size`, 0.01, { required: true, max: 100000 })),
    unit: V.take(V.oneOf(b.serving_unit ?? 'g', `${prefix}serving_unit`, ['g', 'ml', 'oz', 'lb', 'kg'], { required: true })),
  };
}

// POST /nutrition/diary  { date, food_id, serving_size, serving_unit?, meal_slot? } — no meal_slot = log now, choose later
const logEntry = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const date = V.take(V.dateStr(b.date, 'date', { required: true }));
    const foodId = V.take(V.intIn(b.food_id, 'food_id', 1, 2147483647, { required: true }));
    const { size, unit } = servingArgs(b);
    const out = await tx(async db => {
      const slot = await slotArg(db, uid, b.meal_slot);
      const food = await loggableFood(db, foodId, uid);
      if (!food) throw httpError(404, 'Food not found');
      const meal = await targetMeal(db, uid, date, slot);
      return { entry: await insertEntry(db, meal.id, food, size, unit), meal_id: meal.id, meal_slot: slot, unassigned: slot === null };
    });
    res.status(201).json({ ...out, goal_warnings: await warningsFor(uid, date) });
  } catch (err) { fail(res, err, 'log food'); }
};

// PUT /nutrition/diary/:mealFoodId/assign  { meal_slot } — move an entry (unassigned or not) to a meal of the same day
const assignEntry = async (req, res) => {
  const uid = req.user.userId;
  try {
    const slotRaw = req.body?.meal_slot;
    if (slotRaw === undefined || slotRaw === null) throw V.badRequest('meal_slot is required');
    const out = await tx(async db => {
      const slot = await slotArg(db, uid, slotRaw);
      const id = idOf(req.params.mealFoodId);
      const cur = id && await db.query(
        `SELECT mf.id, m.id AS meal_id, m.meal_date, m.unassigned FROM meal_foods mf JOIN meals m ON m.id = mf.meal_id
         WHERE mf.id = $1 AND m.user_id = $2 FOR UPDATE OF mf`, [id, uid]
      );
      if (!cur || !cur.rows.length) throw httpError(404, 'Entry not found');
      const date = require('../utils/programSchedule').dbDate(cur.rows[0].meal_date);
      const meal = await targetMeal(db, uid, date, slot);
      if (meal.id === cur.rows[0].meal_id) return { meal_food_id: id, meal_id: meal.id, meal_slot: slot, moved: false };
      await db.query(`UPDATE meal_foods SET meal_id = $1 WHERE id = $2`, [meal.id, id]);
      // An unassigned meals row holds one entry; remove it once empty.
      await db.query(`DELETE FROM meals m WHERE m.id = $1 AND m.unassigned AND NOT EXISTS (SELECT 1 FROM meal_foods WHERE meal_id = m.id)`, [cur.rows[0].meal_id]);
      return { meal_food_id: id, meal_id: meal.id, meal_slot: slot, moved: true, date };
    });
    res.json(out);
  } catch (err) { fail(res, err, 'assign food'); }
};

// ── Meal templates ────────────────────────────────────────────────────────────

async function templateItems(db, items, uid) {
  if (!Array.isArray(items) || !items.length) throw V.badRequest('items must be a non-empty list of { food_id, serving_size, serving_unit? }');
  if (items.length > 50) throw V.badRequest('At most 50 foods in a template');
  const out = [];
  for (const [i, it] of items.entries()) {
    const foodId = V.take(V.intIn(it?.food_id, `items[${i}].food_id`, 1, 2147483647, { required: true }));
    const { size, unit } = servingArgs(it || {}, `items[${i}].`);
    if (!(await loggableFood(db, foodId, uid))) throw V.badRequest(`items[${i}].food_id is not a food you can use`);
    out.push({ food_id: foodId, serving_size: size, serving_unit: unit });
  }
  return out;
}

async function loadTemplate(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const t = await db.query(`SELECT * FROM meal_templates WHERE id = $1 AND user_id = $2`, [n, uid]);
  if (!t.rows.length) return null;
  const items = await db.query(
    `SELECT i.id, i.food_id, f.name AS food_name, i.serving_size::float AS serving_size, i.serving_unit, i.order_index
     FROM meal_template_items i JOIN foods f ON f.id = i.food_id WHERE i.template_id = $1 ORDER BY i.order_index, i.id`, [n]
  );
  return { ...t.rows[0], items: items.rows };
}

async function writeItems(db, templateId, items) {
  await db.query(`DELETE FROM meal_template_items WHERE template_id = $1`, [templateId]);
  for (const [i, it] of items.entries()) {
    await db.query(`INSERT INTO meal_template_items (template_id, food_id, serving_size, serving_unit, order_index) VALUES ($1,$2,$3,$4,$5)`,
      [templateId, it.food_id, it.serving_size, it.serving_unit, i + 1]);
  }
}

// GET /nutrition/meal-templates
const listTemplates = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.*, (SELECT COUNT(*)::int FROM meal_template_items i WHERE i.template_id = t.id) AS item_count
       FROM meal_templates t WHERE t.user_id = $1 ORDER BY lower(t.name), t.id`, [req.user.userId]
    );
    res.json({ templates: r.rows });
  } catch (err) { fail(res, err, 'list templates'); }
};
// GET /nutrition/meal-templates/:id
const getTemplate = async (req, res) => {
  try {
    const t = await loadTemplate(pool, req.params.id, req.user.userId);
    if (!t) throw httpError(404, 'Template not found');
    res.json({ template: t });
  } catch (err) { fail(res, err, 'get template'); }
};
// POST /nutrition/meal-templates  { name, notes?, items: [{ food_id, serving_size, serving_unit? }] }
const createTemplate = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const name = V.take(V.text(b.name, 'name', 100, { required: true }));
    const notes = V.take(V.text(b.notes, 'notes', 2000));
    const id = await tx(async db => {
      const items = await templateItems(db, b.items, uid);
      const t = await db.query(`INSERT INTO meal_templates (user_id, name, notes) VALUES ($1,$2,$3) RETURNING id`, [uid, name, notes]);
      await writeItems(db, t.rows[0].id, items);
      return t.rows[0].id;
    });
    res.status(201).json({ template: await loadTemplate(pool, id, uid) });
  } catch (err) { fail(res, err, 'create template'); }
};
// PUT /nutrition/meal-templates/:id  { name?, notes?, items? (replaces) }
const updateTemplate = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    await tx(async db => {
      const t = await loadTemplate(db, req.params.id, uid);
      if (!t) throw httpError(404, 'Template not found');
      const f = {};
      if ('name' in b) f.name = V.take(V.text(b.name, 'name', 100, { required: true }));
      if ('notes' in b) f.notes = V.take(V.text(b.notes, 'notes', 2000));
      const keys = Object.keys(f);
      if (keys.length) await db.query(`UPDATE meal_templates SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1}`, [...Object.values(f), t.id]);
      if ('items' in b) await writeItems(db, t.id, await templateItems(db, b.items, uid));
    });
    res.json({ template: await loadTemplate(pool, req.params.id, uid) });
  } catch (err) { fail(res, err, 'update template'); }
};
// DELETE /nutrition/meal-templates/:id
const deleteTemplate = async (req, res) => {
  try {
    const n = idOf(req.params.id);
    const r = n && await pool.query(`DELETE FROM meal_templates WHERE id = $1 AND user_id = $2 RETURNING id`, [n, req.user.userId]);
    if (!r || !r.rows.length) throw httpError(404, 'Template not found');
    res.json({ message: 'Template deleted' });
  } catch (err) { fail(res, err, 'delete template'); }
};
// POST /nutrition/meal-templates/:id/apply  { date, meal_slot }
const applyTemplate = async (req, res) => {
  const uid = req.user.userId;
  try {
    const date = V.take(V.dateStr(req.body?.date, 'date', { required: true }));
    if (req.body?.meal_slot === undefined || req.body?.meal_slot === null) throw V.badRequest('meal_slot is required');
    const out = await tx(async db => {
      const slot = await slotArg(db, uid, req.body.meal_slot);
      const t = await loadTemplate(db, req.params.id, uid);
      if (!t) throw httpError(404, 'Template not found');
      const meal = await targetMeal(db, uid, date, slot);
      const created = [];
      for (const it of t.items) {
        const food = await loggableFood(db, it.food_id, uid);
        if (!food) continue;   // archived since the template was saved: skipped
        created.push(await insertEntry(db, meal.id, food, it.serving_size, it.serving_unit));
      }
      return { meal_id: meal.id, meal_slot: slot, created, skipped: t.items.length - created.length };
    });
    res.status(201).json({ ...out, goal_warnings: await warningsFor(uid, date) });
  } catch (err) { fail(res, err, 'apply template'); }
};

// ── Copy a day ────────────────────────────────────────────────────────────────

// POST /nutrition/days/:date/copy  { to_date, meal_slots?: [n], include_unassigned?: false }
// Copies the logged foods (same food, serving and stored values) into the
// matching meals of to_date (created when missing). Returns the new rows.
const copyDay = async (req, res) => {
  const uid = req.user.userId;
  try {
    const from = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const to = V.take(V.dateStr(req.body?.to_date, 'to_date', { required: true }));
    if (from === to) throw V.badRequest('to_date must be a different day');
    const slotsRaw = req.body?.meal_slots;
    if (slotsRaw !== undefined && slotsRaw !== null && (!Array.isArray(slotsRaw) || !slotsRaw.length)) throw V.badRequest('meal_slots must be a non-empty list of meal numbers');
    const includeUnassigned = V.take(V.bool(req.body?.include_unassigned, 'include_unassigned')) ?? false;
    const out = await tx(async db => {
      const wanted = slotsRaw ? await Promise.all(slotsRaw.map((s, i) => slotArg(db, uid, s, `meal_slots[${i}]`))) : null;
      const src = await db.query(
        `SELECT m.unassigned, m.meal_type, ${EFFECTIVE_SLOT('m')} AS slot, mf.*
         FROM meals m JOIN meal_foods mf ON mf.meal_id = m.id
         WHERE m.user_id = $1 AND m.meal_date = $2 ORDER BY m.id, mf.id`, [uid, from]
      );
      const created = []; const mealBySlot = new Map();
      for (const row of src.rows) {
        if (row.unassigned && !includeUnassigned) continue;
        if (!row.unassigned && wanted && !wanted.includes(row.slot)) continue;
        if (!row.unassigned && row.slot === null && wanted) continue;
        let meal;
        if (row.unassigned) meal = await targetMeal(db, uid, to, null);
        else if (row.slot === null) {
          // a meal_type 'other' row keeps its type on the new day
          meal = mealBySlot.get('other') || (await db.query(`INSERT INTO meals (user_id, meal_date, meal_type) VALUES ($1,$2,'other') RETURNING *`, [uid, to])).rows[0];
          mealBySlot.set('other', meal);
        } else {
          meal = mealBySlot.get(row.slot) || await targetMeal(db, uid, to, row.slot);
          mealBySlot.set(row.slot, meal);
        }
        const r = await db.query(
          `INSERT INTO meal_foods (meal_id, food_id, serving_size, serving_unit, calories, protein, carbs, fat, fiber, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [meal.id, row.food_id, row.serving_size, row.serving_unit, row.calories, row.protein, row.carbs, row.fat, row.fiber, row.notes]
        );
        created.push({ ...r.rows[0], meal_slot: row.unassigned ? null : row.slot, unassigned: row.unassigned });
      }
      return created;
    });
    res.status(201).json({ from_date: from, to_date: to, created: out, count: out.length });
  } catch (err) { fail(res, err, 'copy day'); }
};

// ── Water ─────────────────────────────────────────────────────────────────────
// Amounts are fluid ounces, like the app's browser storage today
// (ripfit_water_<date>, ripfit_water_goal, ripfit_water_preset).

const ozArg = (v, f, min = 0) => V.take(V.numMin(v, f, min, { required: true, max: 1000 }));

// GET /nutrition/water?from=&to=
const listWater = async (req, res) => {
  try {
    const from = V.take(V.dateStr(req.query.from, 'from', { required: true }));
    const to = V.take(V.dateStr(req.query.to, 'to', { required: true }));
    const r = await pool.query(
      `SELECT to_char(log_date, 'YYYY-MM-DD') AS date, amount_oz::float AS amount_oz, source FROM water_logs
       WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date`, [req.user.userId, from, to]
    );
    const u = await pool.query(`SELECT water_goal_oz::float AS goal_oz, water_preset_oz::float AS preset_oz FROM users WHERE id = $1`, [req.user.userId]);
    res.json({ from, to, ...u.rows[0], days: r.rows });
  } catch (err) { fail(res, err, 'list water'); }
};
// GET /nutrition/water/:date
const getWater = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const r = await pool.query(`SELECT amount_oz::float AS amount_oz, source, updated_at FROM water_logs WHERE user_id = $1 AND log_date = $2`, [req.user.userId, date]);
    const u = await pool.query(`SELECT water_goal_oz::float AS goal_oz, water_preset_oz::float AS preset_oz FROM users WHERE id = $1`, [req.user.userId]);
    res.json({ date, amount_oz: r.rows[0]?.amount_oz ?? 0, logged: r.rows.length > 0, ...u.rows[0] });
  } catch (err) { fail(res, err, 'get water'); }
};
// PUT /nutrition/water/:date  { amount_oz } — set the day's total
const setWater = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const amount = ozArg(req.body?.amount_oz, 'amount_oz');
    const r = await pool.query(
      `INSERT INTO water_logs (user_id, log_date, amount_oz) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, log_date) DO UPDATE SET amount_oz = EXCLUDED.amount_oz, source = 'app', updated_at = NOW()
       RETURNING amount_oz::float AS amount_oz`, [req.user.userId, date, amount]
    );
    res.json({ date, amount_oz: r.rows[0].amount_oz });
  } catch (err) { fail(res, err, 'save water'); }
};
// POST /nutrition/water/:date/add  { amount_oz } (negative removes; never below 0)
const addWater = async (req, res) => {
  try {
    const date = V.take(V.dateStr(req.params.date, 'date', { required: true }));
    const delta = V.take(V.numMin(req.body?.amount_oz, 'amount_oz', -1000, { required: true, max: 1000 }));
    const r = await pool.query(
      `INSERT INTO water_logs (user_id, log_date, amount_oz) VALUES ($1,$2,GREATEST($3::numeric, 0))
       ON CONFLICT (user_id, log_date) DO UPDATE SET amount_oz = LEAST(GREATEST(water_logs.amount_oz + $3::numeric, 0), 99999), source = 'app', updated_at = NOW()
       RETURNING amount_oz::float AS amount_oz`, [req.user.userId, date, delta]
    );
    res.json({ date, amount_oz: r.rows[0].amount_oz });
  } catch (err) { fail(res, err, 'add water'); }
};
// PUT /nutrition/water-settings  { goal_oz?, preset_oz? }
const putWaterSettings = async (req, res) => {
  try {
    const b = req.body || {};
    const f = {};
    if ('goal_oz' in b) f.water_goal_oz = b.goal_oz === null ? null : ozArg(b.goal_oz, 'goal_oz', 1);
    if ('preset_oz' in b) f.water_preset_oz = b.preset_oz === null ? null : ozArg(b.preset_oz, 'preset_oz', 1);
    const keys = Object.keys(f);
    if (!keys.length) throw V.badRequest('Send goal_oz and/or preset_oz');
    const r = await pool.query(
      `UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}
       RETURNING water_goal_oz::float AS goal_oz, water_preset_oz::float AS preset_oz`, [...Object.values(f), req.user.userId]
    );
    res.json(r.rows[0]);
  } catch (err) { fail(res, err, 'save water settings'); }
};
// POST /nutrition/water/import  { entries: { "YYYY-MM-DD": oz, ... } | [{ date, amount_oz }], goal_oz?, preset_oz? }
// One-time copy of the browser's values. Idempotent: a date already in the
// database is never changed (so importing twice changes nothing), and the goal
// and preset are only filled in when not set yet.
const importWater = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    let list = b.entries;
    if (list && !Array.isArray(list) && typeof list === 'object') list = Object.entries(list).map(([date, amount_oz]) => ({ date, amount_oz }));
    if (!Array.isArray(list)) throw V.badRequest('entries must be { "YYYY-MM-DD": ounces } or [{ date, amount_oz }]');
    if (list.length > 3660) throw V.badRequest('At most 3660 days per import');
    const rows = list.map((e, i) => ({ date: V.take(V.dateStr(e?.date, `entries[${i}].date`, { required: true })), oz: ozArg(e?.amount_oz, `entries[${i}].amount_oz`) }));
    const goal = b.goal_oz === undefined || b.goal_oz === null ? null : ozArg(b.goal_oz, 'goal_oz', 1);
    const preset = b.preset_oz === undefined || b.preset_oz === null ? null : ozArg(b.preset_oz, 'preset_oz', 1);
    const out = await tx(async db => {
      let imported = 0;
      for (const r of rows) {
        const ins = await db.query(
          `INSERT INTO water_logs (user_id, log_date, amount_oz, source) VALUES ($1,$2,$3,'import') ON CONFLICT (user_id, log_date) DO NOTHING RETURNING log_date`,
          [uid, r.date, r.oz]
        );
        imported += ins.rows.length;
      }
      const s = await db.query(
        `UPDATE users SET water_goal_oz = COALESCE(water_goal_oz, $1), water_preset_oz = COALESCE(water_preset_oz, $2) WHERE id = $3
         RETURNING water_goal_oz::float AS goal_oz, water_preset_oz::float AS preset_oz`, [goal, preset, uid]
      );
      return { received: rows.length, imported, skipped_existing: rows.length - imported, ...s.rows[0] };
    });
    res.json(out);
  } catch (err) { fail(res, err, 'import water'); }
};

module.exports = {
  getSlots, putSlots, getDay, logEntry, assignEntry, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  applyTemplate, copyDay, listWater, getWater, setWater, addWater, putWaterSettings, importWater, EFFECTIVE_SLOT,
};
