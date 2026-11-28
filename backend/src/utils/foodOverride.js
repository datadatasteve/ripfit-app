// Per-user food overrides (Phase 1B-2), stored in user_food_overrides (004).
// One row per user and food; each value is per 100 g like the foods columns,
// and NULL means "use the food's own value". Only the user who saved an
// override ever sees it.

// user_food_overrides column → foods column it replaces
const OVERRIDE_COLUMNS = {
  calories: 'calories_per_100g',
  protein_g: 'protein_per_100g',
  carbs_g: 'carbs_per_100g',
  fat_g: 'fat_per_100g',
  fiber_g: 'fiber_per_100g',
  sugar_g: 'sugar_per_100g',
};

async function overrideFor(db, uid, foodId) {
  const r = await db.query(`SELECT * FROM user_food_overrides WHERE user_id = $1 AND food_id = $2`, [uid, foodId]);
  return r.rows[0] || null;
}

/**
 * The food as this user sees it: overridden columns replaced, plus
 * has_override, override (the stored row's values) and original (the food's
 * own values for the replaced columns). Without an override the food is
 * returned with has_override: false and nothing else changed.
 */
function applyOverride(food, ov) {
  if (!food) return food;
  if (!ov) return { ...food, has_override: false };
  const out = { ...food, has_override: true, original: {}, override: { notes: ov.notes, updated_at: ov.updated_at } };
  for (const [oc, fc] of Object.entries(OVERRIDE_COLUMNS)) {
    out.override[oc] = ov[oc];
    if (ov[oc] !== null && ov[oc] !== undefined) {
      out.original[fc] = food[fc];
      out[fc] = ov[oc];
    }
  }
  return out;
}

async function foodForUser(db, food, uid) {
  if (!food) return food;
  return applyOverride(food, await overrideFor(db, uid, food.id));
}

module.exports = { OVERRIDE_COLUMNS, overrideFor, applyOverride, foodForUser };
