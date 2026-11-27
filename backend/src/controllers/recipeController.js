// backend/src/controllers/recipeController.js
// Recipes (Phase 1B-1): manual recipes, and imports from a URL (the page's
// schema.org Recipe JSON-LD), pasted text and CSV/JSON. Rules-based only; no
// AI calls. Imports are saved as drafts (status 'draft') for later review.
const { pool } = require('../config/database');
const V = require('../utils/validate');
const { parseIngredientLine, recipeFromHtml, recipeFromText, recipesFromFile } = require('../utils/recipeParse');
const { safeFetch } = require('../utils/safeFetch');

function fail(res, err, what) {
  if ([400, 404, 409, 422].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${what} error:`, err.message);
  return res.status(500).json({ error: `Failed to ${what}` });
}
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const idOf = raw => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };

const MAX_INGREDIENTS = 200;
const MAX_STEPS = 200;

/**
 * An "obvious" food match: a food the user may use (public, or their own)
 * whose name equals the ingredient name, ignoring case and a trailing "s".
 * Only a single candidate counts; otherwise the line stays unmatched.
 */
async function matchFood(db, name, uid) {
  if (!name || name.length > 120) return null;
  const n = name.toLowerCase().trim();
  const forms = [...new Set([n, n.replace(/s$/, ''), `${n}s`])];
  const r = await db.query(
    `SELECT id FROM foods WHERE lower(name) = ANY($1::text[]) AND archived_at IS NULL
       AND (created_by_user_id IS NULL OR created_by_user_id = $2) LIMIT 2`,
    [forms, uid]
  );
  return r.rows.length === 1 ? r.rows[0].id : null;
}

/** Ingredient input: a line of text, or { quantity, unit, name, food_id, notes }. */
async function buildIngredients(db, list, uid, { match = true } = {}) {
  if (!Array.isArray(list)) throw V.badRequest('ingredients must be a list');
  if (list.length > MAX_INGREDIENTS) throw V.badRequest(`At most ${MAX_INGREDIENTS} ingredients`);
  const out = [];
  for (const [i, item] of list.entries()) {
    let ing;
    if (typeof item === 'string') {
      ing = parseIngredientLine(item);
      if (!ing) continue;
      if (ing.raw_text.length > 500) throw V.badRequest(`ingredients[${i}] is too long`);
      ing.food_id = match ? await matchFood(db, ing.name, uid) : null;
    } else if (item && typeof item === 'object') {
      ing = {
        raw_text: V.take(V.text(item.raw_text, `ingredients[${i}].raw_text`, 500)),
        quantity: V.take(V.numMin(item.quantity, `ingredients[${i}].quantity`, 0, { max: 100000 })),
        unit: V.take(V.text(item.unit, `ingredients[${i}].unit`, 30)),
        name: V.take(V.text(item.name, `ingredients[${i}].name`, 300)),
        notes: V.take(V.text(item.notes, `ingredients[${i}].notes`, 500)),
        food_id: V.take(V.intIn(item.food_id, `ingredients[${i}].food_id`, 1, 2147483647)),
      };
      if (!ing.name && !ing.raw_text) throw V.badRequest(`ingredients[${i}] needs a name or raw_text`);
      if (ing.food_id) {
        const f = await db.query(`SELECT 1 FROM foods WHERE id = $1 AND archived_at IS NULL AND (created_by_user_id IS NULL OR created_by_user_id = $2)`, [ing.food_id, uid]);
        if (!f.rows.length) throw V.badRequest(`ingredients[${i}].food_id is not a food you can use`);
      } else if (match && ing.name) ing.food_id = await matchFood(db, ing.name, uid);
    } else throw V.badRequest(`ingredients[${i}] must be text or an object`);
    out.push(ing);
  }
  return out;
}

function stepsOf(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw V.badRequest('steps must be a list of text');
  if (list.length > MAX_STEPS) throw V.badRequest(`At most ${MAX_STEPS} steps`);
  return list.map((s, i) => V.take(V.text(String(s ?? ''), `steps[${i}]`, 5000))).filter(Boolean);
}

async function loadRecipe(db, id, uid) {
  const n = idOf(id);
  if (!n) return null;
  const r = await db.query(`SELECT * FROM recipes WHERE id = $1 AND user_id = $2`, [n, uid]);
  if (!r.rows.length) return null;
  const ing = await db.query(
    `SELECT ri.id, ri.order_index, ri.raw_text, ri.quantity::float AS quantity, ri.unit, ri.name, ri.food_id, f.name AS food_name, ri.notes
     FROM recipe_ingredients ri LEFT JOIN foods f ON f.id = ri.food_id WHERE ri.recipe_id = $1 ORDER BY ri.order_index, ri.id`,
    [n]
  );
  return { ...r.rows[0], servings: r.rows[0].servings === null ? null : Number(r.rows[0].servings), ingredients: ing.rows,
    unmatched_ingredients: ing.rows.filter(i => !i.food_id).length };
}

async function insertRecipe(db, uid, rec, ingredients, { status, sourceType }) {
  const r = await db.query(
    `INSERT INTO recipes (user_id, name, servings, steps, notes, status, source_type, source_url, source_title, source_author)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [uid, rec.name, rec.servings, JSON.stringify(rec.steps), rec.notes, status, sourceType,
     rec.source_url || null, rec.source_title || null, rec.source_author || null]
  );
  const id = r.rows[0].id;
  for (const [i, ing] of ingredients.entries()) {
    await db.query(
      `INSERT INTO recipe_ingredients (recipe_id, order_index, raw_text, quantity, unit, name, food_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, i + 1, ing.raw_text, ing.quantity, ing.unit, ing.name, ing.food_id, ing.notes]
    );
  }
  return id;
}

function recipeFields(b, { creating }) {
  const out = {};
  if (creating || 'name' in b) out.name = V.take(V.text(b.name, 'name', 200, { required: true }));
  if ('servings' in b) out.servings = V.take(V.numMin(b.servings, 'servings', 0.01, { max: 1000 }));
  if ('notes' in b) out.notes = V.take(V.text(b.notes, 'notes', 10000));
  if ('status' in b) out.status = V.take(V.oneOf(b.status, 'status', ['draft', 'ready'], { required: true }));
  if ('source_url' in b) out.source_url = V.take(V.url(b.source_url, 'source_url'));
  if ('source_title' in b) out.source_title = V.take(V.text(b.source_title, 'source_title', 300));
  if ('source_author' in b) out.source_author = V.take(V.text(b.source_author, 'source_author', 200));
  if ('steps' in b) out.steps = stepsOf(b.steps);
  return out;
}

async function tx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

// GET /nutrition/recipes?status=draft
const listRecipes = async (req, res) => {
  try {
    const status = V.take(V.oneOf(req.query.status, 'status', ['draft', 'ready']));
    const r = await pool.query(
      `SELECT r.id, r.name, r.servings::float AS servings, r.status, r.source_type, r.source_url, r.source_title, r.source_author,
              r.created_at, r.updated_at, (SELECT COUNT(*)::int FROM recipe_ingredients ri WHERE ri.recipe_id = r.id) AS ingredient_count
       FROM recipes r WHERE r.user_id = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY r.updated_at DESC, r.id DESC`,
      [req.user.userId, status]
    );
    res.json({ recipes: r.rows });
  } catch (err) { fail(res, err, 'list recipes'); }
};

// GET /nutrition/recipes/:id
const getRecipe = async (req, res) => {
  try {
    const r = await loadRecipe(pool, req.params.id, req.user.userId);
    if (!r) throw httpError(404, 'Recipe not found');
    res.json({ recipe: r });
  } catch (err) { fail(res, err, 'get recipe'); }
};

// POST /nutrition/recipes  { name, servings?, ingredients: [text | {...}], steps?, notes?, source_url?, source_title?, source_author? }
const createRecipe = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const f = recipeFields(b, { creating: true });
    const id = await tx(async db => {
      const ings = await buildIngredients(db, b.ingredients ?? [], uid);
      return insertRecipe(db, uid, { servings: null, notes: null, steps: [], ...f }, ings, { status: f.status || 'ready', sourceType: 'manual' });
    });
    res.status(201).json({ recipe: await loadRecipe(pool, id, uid) });
  } catch (err) { fail(res, err, 'create recipe'); }
};

// PUT /nutrition/recipes/:id  — fields sent change; `ingredients` (when sent) replaces the list
const updateRecipe = async (req, res) => {
  const uid = req.user.userId;
  try {
    const b = req.body || {};
    const f = recipeFields(b, { creating: false });
    await tx(async db => {
      const cur = await loadRecipe(db, req.params.id, uid);
      if (!cur) throw httpError(404, 'Recipe not found');
      const keys = Object.keys(f);
      if (keys.length) {
        await db.query(
          `UPDATE recipes SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1}`,
          [...keys.map(k => (k === 'steps' ? JSON.stringify(f[k]) : f[k])), cur.id]
        );
      }
      if ('ingredients' in b) {
        const ings = await buildIngredients(db, b.ingredients ?? [], uid);
        await db.query(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [cur.id]);
        for (const [i, ing] of ings.entries()) {
          await db.query(
            `INSERT INTO recipe_ingredients (recipe_id, order_index, raw_text, quantity, unit, name, food_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [cur.id, i + 1, ing.raw_text, ing.quantity, ing.unit, ing.name, ing.food_id, ing.notes]
          );
        }
        await db.query(`UPDATE recipes SET updated_at = NOW() WHERE id = $1`, [cur.id]);
      }
    });
    res.json({ recipe: await loadRecipe(pool, req.params.id, uid) });
  } catch (err) { fail(res, err, 'update recipe'); }
};

// DELETE /nutrition/recipes/:id
const deleteRecipe = async (req, res) => {
  try {
    const n = idOf(req.params.id);
    const r = n && await pool.query(`DELETE FROM recipes WHERE id = $1 AND user_id = $2 RETURNING id`, [n, req.user.userId]);
    if (!r || !r.rows.length) throw httpError(404, 'Recipe not found');
    res.json({ message: 'Recipe deleted' });
  } catch (err) { fail(res, err, 'delete recipe'); }
};

/** Saves parsed recipes as drafts and returns them. */
async function saveDrafts(uid, parsed, sourceType) {
  const ids = await tx(async db => {
    const out = [];
    for (const rec of parsed) {
      const name = (rec.name || '').trim().slice(0, 200) || 'Imported recipe';
      const ings = await buildIngredients(db, (rec.ingredients || []).slice(0, MAX_INGREDIENTS).map(s => String(s).slice(0, 500)), uid);
      out.push(await insertRecipe(db, uid, {
        name, servings: rec.servings && rec.servings > 0 && rec.servings <= 1000 ? rec.servings : null,
        steps: (rec.steps || []).slice(0, MAX_STEPS).map(s => String(s).slice(0, 5000)).filter(Boolean),
        notes: rec.notes ? String(rec.notes).slice(0, 10000) : null,
        source_url: rec.source_url && /^https?:\/\//i.test(rec.source_url) ? String(rec.source_url).slice(0, 2000) : null,
        source_title: rec.source_title ? String(rec.source_title).slice(0, 300) : null,
        source_author: rec.source_author ? String(rec.source_author).slice(0, 200) : null,
      }, ings, { status: 'draft', sourceType }));
    }
    return out;
  });
  const recipes = [];
  for (const id of ids) recipes.push(await loadRecipe(pool, id, uid));
  return recipes;
}

// POST /nutrition/recipes/import/url  { url }
const importFromUrl = async (req, res) => {
  try {
    const url = V.take(V.text(req.body?.url, 'url', 2000, { required: true }));
    const page = await safeFetch(url);
    const rec = recipeFromHtml(page.body, page.url);
    if (!rec) throw httpError(422, 'No recipe data was found on that page (it needs schema.org Recipe markup)');
    if (!rec.source_url) rec.source_url = page.url;
    const [recipe] = await saveDrafts(req.user.userId, [rec], 'url');
    res.status(201).json({ recipe });
  } catch (err) { fail(res, err, 'import recipe'); }
};

// POST /nutrition/recipes/import/text  { text }
const importFromText = async (req, res) => {
  try {
    const text = V.take(V.text(req.body?.text, 'text', 100000, { required: true }));
    const rec = recipeFromText(text);
    if (!rec) throw V.badRequest('No recipe found in the text');
    const [recipe] = await saveDrafts(req.user.userId, [rec], 'text');
    res.status(201).json({ recipe });
  } catch (err) { fail(res, err, 'import recipe'); }
};

// POST /nutrition/recipes/import/file  { format: csv | json, content } (up to 50 recipes)
const importFromFile = async (req, res) => {
  try {
    const format = V.take(V.oneOf(req.body?.format, 'format', ['csv', 'json'], { required: true }));
    const content = V.take(V.text(req.body?.content, 'content', 1000000, { required: true }));
    let parsed;
    try { parsed = recipesFromFile(format, content); } catch (e) { throw V.badRequest(e.message); }
    parsed = parsed.filter(r => r.name);
    if (!parsed.length) throw V.badRequest('No recipes with a name were found');
    if (parsed.length > 50) throw V.badRequest('At most 50 recipes per import');
    const recipes = await saveDrafts(req.user.userId, parsed, 'file');
    res.status(201).json({ recipes });
  } catch (err) { fail(res, err, 'import recipes'); }
};

module.exports = { listRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe, importFromUrl, importFromText, importFromFile };
