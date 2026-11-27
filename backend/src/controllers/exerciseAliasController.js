// backend/src/controllers/exerciseAliasController.js
// Exercise aliases and per-user default names (Phase 1A-1).
// - Global aliases (user_id NULL) are curated by admins.
// - A user's own aliases and default name are private to that user.
// Exercise search (workoutController.searchExercises) matches all of them.
const { pool } = require('../config/database');
const V = require('../utils/validate');

const ALIAS_MAX = 100;

async function isAdmin(userId) {
  const r = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  return !!r.rows[0]?.is_admin;
}

/** The exercise id when it exists, else null (also null for a malformed id). */
async function exerciseExists(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) return null;
  const r = await pool.query('SELECT id FROM exercises WHERE id = $1', [n]);
  return r.rows[0]?.id || null;
}

function fail(res, err, what) {
  if (err.code === '23505') return res.status(409).json({ error: 'That alias already exists for this exercise' });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}

// GET /workouts/exercises/:id/aliases — global aliases, the caller's own, and their default name
const listAliases = async (req, res) => {
  const uid = req.user.userId;
  try {
    const exId = await exerciseExists(req.params.id);
    if (!exId) return res.status(404).json({ error: 'Exercise not found' });
    const [aliases, name] = await Promise.all([
      pool.query(
        `SELECT id, alias, user_id IS NULL AS is_global, created_at
         FROM exercise_aliases WHERE exercise_id = $1 AND (user_id IS NULL OR user_id = $2)
         ORDER BY user_id NULLS FIRST, lower(alias)`,
        [exId, uid]
      ),
      pool.query(`SELECT display_name FROM user_exercise_names WHERE user_id = $1 AND exercise_id = $2`, [uid, exId]),
    ]);
    res.json({
      exercise_id: exId,
      default_name: name.rows[0]?.display_name || null,
      global: aliases.rows.filter(a => a.is_global).map(({ is_global, ...a }) => a),
      mine: aliases.rows.filter(a => !a.is_global).map(({ is_global, ...a }) => a),
    });
  } catch (err) { fail(res, err, 'list aliases'); }
};

async function addAlias(req, res, { global }) {
  const uid = req.user.userId;
  const alias = V.text(req.body?.alias, 'alias', ALIAS_MAX, { required: true });
  if (alias.error) return res.status(400).json({ error: alias.error });
  try {
    if (global && !(await isAdmin(uid))) return res.status(403).json({ error: 'Admin access required' });
    const exId = await exerciseExists(req.params.id);
    if (!exId) return res.status(404).json({ error: 'Exercise not found' });
    const r = await pool.query(
      `INSERT INTO exercise_aliases (exercise_id, user_id, alias, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, exercise_id, alias, user_id IS NULL AS is_global, created_at`,
      [exId, global ? null : uid, alias.value.replace(/\s+/g, ' '), uid]
    );
    res.status(201).json({ alias: r.rows[0] });
  } catch (err) { fail(res, err, 'add alias'); }
}

// POST /workouts/exercises/:id/aliases — the caller's own alias
const addUserAlias = (req, res) => addAlias(req, res, { global: false });
// POST /admin/exercises/:id/aliases — a global alias (admin only)
const addGlobalAlias = (req, res) => addAlias(req, res, { global: true });

// DELETE /workouts/exercises/aliases/:aliasId — only the caller's own alias
const deleteUserAlias = async (req, res) => {
  const id = V.intIn(req.params.aliasId, 'aliasId', 1, 2147483647, { required: true });
  if (id.error) return res.status(404).json({ error: 'Alias not found' });
  try {
    const r = await pool.query(`DELETE FROM exercise_aliases WHERE id = $1 AND user_id = $2 RETURNING id`, [id.value, req.user.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Alias not found' });
    res.json({ message: 'Alias deleted' });
  } catch (err) { fail(res, err, 'delete alias'); }
};

// DELETE /admin/exercise-aliases/:aliasId — a global alias (admin only)
const deleteGlobalAlias = async (req, res) => {
  try {
    if (!(await isAdmin(req.user.userId))) return res.status(403).json({ error: 'Admin access required' });
    const id = V.intIn(req.params.aliasId, 'aliasId', 1, 2147483647, { required: true });
    if (id.error) return res.status(404).json({ error: 'Alias not found' });
    const r = await pool.query(`DELETE FROM exercise_aliases WHERE id = $1 AND user_id IS NULL RETURNING id`, [id.value]);
    if (!r.rows.length) return res.status(404).json({ error: 'Alias not found' });
    res.json({ message: 'Alias deleted' });
  } catch (err) { fail(res, err, 'delete alias'); }
};

// GET /admin/exercises/:id/aliases — every global alias of an exercise (admin only)
const listGlobalAliases = async (req, res) => {
  try {
    if (!(await isAdmin(req.user.userId))) return res.status(403).json({ error: 'Admin access required' });
    const exId = await exerciseExists(req.params.id);
    if (!exId) return res.status(404).json({ error: 'Exercise not found' });
    const r = await pool.query(
      `SELECT id, alias, created_by_user_id, created_at FROM exercise_aliases
       WHERE exercise_id = $1 AND user_id IS NULL ORDER BY lower(alias)`,
      [exId]
    );
    res.json({ exercise_id: exId, aliases: r.rows });
  } catch (err) { fail(res, err, 'list aliases'); }
};

// PUT /workouts/exercises/:id/default-name  { name }
const setDefaultName = async (req, res) => {
  const name = V.text(req.body?.name, 'name', 255, { required: true });
  if (name.error) return res.status(400).json({ error: name.error });
  try {
    const exId = await exerciseExists(req.params.id);
    if (!exId) return res.status(404).json({ error: 'Exercise not found' });
    const r = await pool.query(
      `INSERT INTO user_exercise_names (user_id, exercise_id, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, exercise_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
       RETURNING exercise_id, display_name AS default_name, updated_at`,
      [req.user.userId, exId, name.value.replace(/\s+/g, ' ')]
    );
    res.json(r.rows[0]);
  } catch (err) { fail(res, err, 'set default name'); }
};

// DELETE /workouts/exercises/:id/default-name
const clearDefaultName = async (req, res) => {
  try {
    const exId = await exerciseExists(req.params.id);
    if (!exId) return res.status(404).json({ error: 'Exercise not found' });
    const r = await pool.query(
      `DELETE FROM user_exercise_names WHERE user_id = $1 AND exercise_id = $2 RETURNING exercise_id`,
      [req.user.userId, exId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No default name set' });
    res.json({ message: 'Default name removed' });
  } catch (err) { fail(res, err, 'clear default name'); }
};

module.exports = {
  listAliases, addUserAlias, addGlobalAlias, deleteUserAlias, deleteGlobalAlias, listGlobalAliases,
  setDefaultName, clearDefaultName,
};
