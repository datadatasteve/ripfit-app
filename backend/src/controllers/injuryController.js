// backend/src/controllers/injuryController.js
// Injury tracker (Phase 1A-2). The user's own endpoints only; trainer
// suggestions arrive in 1C-1, so the trainer columns exist but only the user
// can accept or dismiss a pending suggestion here. Every response carries the
// disclaimer so each client shows it.
const { pool } = require('../config/database');
const V = require('../utils/validate');

// Owner-revised text (after Phase 1A-2).
const INJURY_DISCLAIMER = 'RipFit is a tool to support your fitness & wellness journey. It does not replace medical care. '
  + 'Follow all advice from your doctor, physical therapist or other medical professional. Remember, form over ego.';

const STATUSES = ['active', 'recovering', 'resolved'];
const COLS = `id, user_id, body_area, side, to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date, status, notes, limit_flag, limit_note, source,
  suggested_by_user_id, suggestion_status, created_at, updated_at`;

function fail(res, err, what) {
  if (err.statusCode === 400) return res.status(400).json({ error: err.message, disclaimer: INJURY_DISCLAIMER });
  if (err.statusCode === 404) return res.status(404).json({ error: err.message, disclaimer: INJURY_DISCLAIMER });
  console.error(`${what} error:`, err);
  return res.status(500).json({ error: `Failed to ${what}`, disclaimer: INJURY_DISCLAIMER });
}
const notFound = () => Object.assign(new Error('Injury not found'), { statusCode: 404 });

function fields(body, { creating }) {
  const out = {};
  const has = k => creating || k in body;
  if (has('body_area')) out.body_area = V.take(V.text(body.body_area, 'body_area', 100, { required: true }));
  if ('side' in body) out.side = V.take(V.oneOf(body.side, 'side', ['left', 'right', 'both']));
  if (has('start_date')) out.start_date = V.take(V.dateStr(body.start_date, 'start_date', { required: true }));
  if ('end_date' in body) out.end_date = V.take(V.dateStr(body.end_date, 'end_date'));
  if ('status' in body) out.status = V.take(V.oneOf(body.status, 'status', STATUSES, { required: true }));
  if ('notes' in body) out.notes = V.take(V.text(body.notes, 'notes', 5000));
  if ('limit_flag' in body) out.limit_flag = V.take(V.oneOf(body.limit_flag, 'limit_flag', ['preference', 'medical']));
  if ('limit_note' in body) out.limit_note = V.take(V.text(body.limit_note, 'limit_note', 2000));
  if ('source' in body && body.source !== 'self') throw V.badRequest("source can only be 'self' here (trainer suggestions come from trainers)");
  return out;
}

async function own(db, id, uid) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) return null;
  const r = await db.query(`SELECT ${COLS} FROM injuries WHERE id = $1 AND user_id = $2`, [n, uid]);
  return r.rows[0] || null;
}

function checkDates(row) {
  if (row.end_date && row.start_date && row.end_date < row.start_date) throw V.badRequest('end_date must be on or after start_date');
}

// GET /injuries?status=active
const listInjuries = async (req, res) => {
  try {
    const status = V.take(V.oneOf(req.query.status, 'status', STATUSES));
    const r = await pool.query(
      `SELECT ${COLS} FROM injuries WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY (status = 'resolved'), start_date DESC, id DESC`,
      [req.user.userId, status]
    );
    res.json({ injuries: r.rows, disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'list injuries'); }
};

// GET /injuries/:id
const getInjury = async (req, res) => {
  try {
    const inj = await own(pool, req.params.id, req.user.userId);
    if (!inj) throw notFound();
    res.json({ injury: inj, disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'get injury'); }
};

// POST /injuries  { body_area, side?, start_date, end_date?, status?, notes?, limit_flag?, limit_note? }
const createInjury = async (req, res) => {
  try {
    const f = fields(req.body || {}, { creating: true });
    checkDates(f);
    if (f.end_date && !f.status) f.status = 'resolved';
    const cols = Object.keys(f);
    const r = await pool.query(
      `INSERT INTO injuries (user_id, source, ${cols.join(', ')})
       VALUES ($1, 'self', ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
      [req.user.userId, ...Object.values(f)]
    );
    res.status(201).json({ injury: await own(pool, r.rows[0].id, req.user.userId), disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'create injury'); }
};

// PUT /injuries/:id
const updateInjury = async (req, res) => {
  try {
    const cur = await own(pool, req.params.id, req.user.userId);
    if (!cur) throw notFound();
    const f = fields(req.body || {}, { creating: false });
    checkDates({ ...cur, ...f });
    const keys = Object.keys(f);
    if (keys.length) {
      await pool.query(
        `UPDATE injuries SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1}`,
        [...Object.values(f), cur.id]
      );
    }
    res.json({ injury: await own(pool, cur.id, req.user.userId), disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'update injury'); }
};

// POST /injuries/:id/resolve  { end_date? } — default end date: today (server date)
const resolveInjury = async (req, res) => {
  try {
    const end = V.take(V.dateStr(req.body?.end_date, 'end_date'));
    const cur = await own(pool, req.params.id, req.user.userId);
    if (!cur) throw notFound();
    const endDate = end || cur.end_date || new Date().toISOString().slice(0, 10);
    checkDates({ ...cur, end_date: endDate });
    await pool.query(`UPDATE injuries SET status = 'resolved', end_date = $1, updated_at = NOW() WHERE id = $2`, [endDate, cur.id]);
    res.json({ injury: await own(pool, cur.id, req.user.userId), disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'resolve injury'); }
};

// PUT /injuries/:id/suggestion  { status: accepted | dismissed } — answer a trainer's suggestion
const answerSuggestion = async (req, res) => {
  try {
    const status = V.take(V.oneOf(req.body?.status, 'status', ['accepted', 'dismissed'], { required: true }));
    const cur = await own(pool, req.params.id, req.user.userId);
    if (!cur) throw notFound();
    if (cur.source !== 'trainer') throw V.badRequest('Only a trainer suggestion can be accepted or dismissed');
    await pool.query(`UPDATE injuries SET suggestion_status = $1, updated_at = NOW() WHERE id = $2`, [status, cur.id]);
    res.json({ injury: await own(pool, cur.id, req.user.userId), disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'answer suggestion'); }
};

// DELETE /injuries/:id
const deleteInjury = async (req, res) => {
  try {
    const cur = await own(pool, req.params.id, req.user.userId);
    if (!cur) throw notFound();
    await pool.query(`DELETE FROM injuries WHERE id = $1`, [cur.id]);
    res.json({ message: 'Injury deleted', disclaimer: INJURY_DISCLAIMER });
  } catch (err) { fail(res, err, 'delete injury'); }
};

module.exports = {
  INJURY_DISCLAIMER, listInjuries, getInjury, createInjury, updateInjury, resolveInjury, answerSuggestion, deleteInjury,
};
