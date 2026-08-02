// backend/src/controllers/adminController.js
// All admin-only endpoints. Every function checks is_admin before proceeding.

const { pool } = require('../config/database');
const bcrypt = require('bcrypt');

// Middleware-style guard — call at top of each handler
async function requireAdmin(req, res) {
  const result = await pool.query(
    'SELECT is_admin FROM users WHERE id = $1',
    [req.user.userId]
  );
  if (!result.rows[0]?.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

// ── GET /admin/users ───────────────────────────────────────────────────────
// Full user list with activity summary
async function listUsers(req, res) {
  if (!(await requireAdmin(req, res))) return;

  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.display_name,
        u.email_verified,
        u.is_admin,
        u.created_at,
        u.profile_picture IS NOT NULL AS has_photo,
        u.goals,
        COUNT(DISTINCT w.id) AS workout_count,
        COUNT(DISTINCT cs.id) AS cardio_count,
        MAX(GREATEST(
          COALESCE(w.start_time, '1970-01-01'),
          COALESCE(cs.start_time, '1970-01-01')
        )) AS last_active,
        COUNT(DISTINCT br.id) AS bug_reports,
        COUNT(DISTINCT el.id) AS error_count
      FROM users u
      LEFT JOIN workouts w ON w.user_id = u.id
      LEFT JOIN cardio_sessions cs ON cs.user_id = u.id
      LEFT JOIN bug_reports br ON br.user_id = u.id
      LEFT JOIN error_logs el ON el.user_id = u.id AND el.resolved = FALSE
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    res.json({ users: result.rows });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

// ── GET /admin/users/:id ───────────────────────────────────────────────────
// Full profile + recent activity for one user
async function getUser(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { id } = req.params;
  try {
    const user = await pool.query(
      `SELECT id, username, email, display_name, profile_picture,
              height_cm, weight_kg, date_of_birth, gender,
              units_weight, units_distance, theme_preference, goals,
              email_verified, is_admin, created_at, workout_rating_prefs
       FROM users WHERE id = $1`,
      [id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Recent workouts
    const workouts = await pool.query(`
      SELECT w.id, w.workout_date, w.start_time, w.end_time, w.status,
             w.session_rating, w.overall_notes,
             COALESCE(r.name, 'Free Lift') AS routine_name,
             EXTRACT(EPOCH FROM (w.end_time - w.start_time))::INTEGER AS duration_seconds,
             COUNT(DISTINCT we.id) AS exercise_count,
             COUNT(ws.id) AS set_count
      FROM workouts w
      LEFT JOIN workout_routines r ON w.routine_id = r.id
      LEFT JOIN workout_exercises we ON we.workout_id = w.id
      LEFT JOIN workout_sets ws ON ws.workout_exercise_id = we.id
      WHERE w.user_id = $1
      GROUP BY w.id, r.name
      ORDER BY w.start_time DESC NULLS LAST
      LIMIT 20
    `, [id]);

    // Recent cardio
    const cardio = await pool.query(`
      SELECT id, session_date, start_time, cardio_type, duration_seconds,
             distance, distance_unit, avg_heart_rate, calories_burned,
             session_rating, status
      FROM cardio_sessions
      WHERE user_id = $1
      ORDER BY start_time DESC NULLS LAST
      LIMIT 20
    `, [id]);

    // Bug reports from this user
    const bugs = await pool.query(`
      SELECT id, title, description, current_view, status, created_at
      FROM bug_reports WHERE user_id = $1
      ORDER BY created_at DESC
    `, [id]);

    // Error logs for this user
    const errors = await pool.query(`
      SELECT id, error_message, component, current_view, severity, resolved, created_at
      FROM error_logs WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [id]);

    res.json({
      user: user.rows[0],
      workouts: workouts.rows,
      cardio: cardio.rows,
      bug_reports: bugs.rows,
      error_logs: errors.rows,
    });
  } catch (err) {
    console.error('getUser error:', err);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
}

// ── PUT /admin/users/:id ───────────────────────────────────────────────────
// Admin actions: verify, toggle admin, reset password
async function updateUser(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { id } = req.params;
  const { email_verified, is_admin, new_password } = req.body;

  try {
    if (new_password !== undefined) {
      const hash = await bcrypt.hash(new_password, 12);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
    }

    if (email_verified !== undefined || is_admin !== undefined) {
      await pool.query(
        `UPDATE users SET
           email_verified = COALESCE($1, email_verified),
           is_admin = COALESCE($2, is_admin)
         WHERE id = $3`,
        [
          email_verified !== undefined ? email_verified : null,
          is_admin !== undefined ? is_admin : null,
          id
        ]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

// ── GET /admin/bug-reports ─────────────────────────────────────────────────
async function listBugReports(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { status } = req.query;
  try {
    const result = await pool.query(`
      SELECT br.id, br.title, br.description, br.current_view,
             br.status, br.admin_notes, br.created_at,
             u.username, u.email
      FROM bug_reports br
      LEFT JOIN users u ON br.user_id = u.id
      ${status ? 'WHERE br.status = $1' : ''}
      ORDER BY br.created_at DESC
    `, status ? [status] : []);

    res.json({ bug_reports: result.rows });
  } catch (err) {
    console.error('listBugReports error:', err);
    res.status(500).json({ error: 'Failed to fetch bug reports' });
  }
}

// ── PUT /admin/bug-reports/:id ─────────────────────────────────────────────
async function updateBugReport(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { id } = req.params;
  const { status, admin_notes } = req.body;

  try {
    await pool.query(
      `UPDATE bug_reports
       SET status = COALESCE($1, status),
           admin_notes = COALESCE($2, admin_notes),
           updated_at = NOW()
       WHERE id = $3`,
      [status || null, admin_notes || null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('updateBugReport error:', err);
    res.status(500).json({ error: 'Failed to update bug report' });
  }
}

// ── GET /admin/error-logs ──────────────────────────────────────────────────
async function listErrorLogs(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { resolved } = req.query;
  try {
    const result = await pool.query(`
      SELECT el.id, el.error_message, el.error_stack, el.component,
             el.current_view, el.severity, el.resolved, el.created_at,
             u.username, u.email
      FROM error_logs el
      LEFT JOIN users u ON el.user_id = u.id
      ${resolved !== undefined ? `WHERE el.resolved = ${resolved === 'true'}` : ''}
      ORDER BY el.created_at DESC
      LIMIT 200
    `);

    res.json({ error_logs: result.rows });
  } catch (err) {
    console.error('listErrorLogs error:', err);
    res.status(500).json({ error: 'Failed to fetch error logs' });
  }
}

// ── PUT /admin/error-logs/:id/resolve ─────────────────────────────────────
async function resolveErrorLog(req, res) {
  if (!(await requireAdmin(req, res))) return;

  try {
    await pool.query(
      'UPDATE error_logs SET resolved = TRUE WHERE id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve error log' });
  }
}

// ── POST /errors (no auth required — called from error boundary) ───────────
// Accepts frontend crash reports. Rate-limited at route level.
async function logClientError(req, res) {
  const {
    error_message, error_stack, component,
    current_view, user_agent, url, severity, user_id
  } = req.body;

  if (!error_message) {
    return res.status(400).json({ error: 'error_message required' });
  }

  try {
    await pool.query(
      `INSERT INTO error_logs
         (user_id, error_message, error_stack, component, current_view,
          user_agent, url, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        user_id || null,
        error_message.slice(0, 2000),
        error_stack ? error_stack.slice(0, 5000) : null,
        component || null,
        current_view || null,
        user_agent || null,
        url || null,
        severity || 'error'
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    // Don't let error logging itself cause a 500 cascade
    console.error('logClientError DB error:', err);
    res.json({ ok: false });
  }
}

// ── POST /bug-reports (authenticated users) ────────────────────────────────
async function submitBugReport(req, res) {
  const { title, description, current_view } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'title and description required' });
  }

  try {
    await pool.query(
      `INSERT INTO bug_reports (user_id, title, description, current_view, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        title.slice(0, 200),
        description.slice(0, 2000),
        current_view || null,
        req.headers['user-agent'] || null
      ]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('submitBugReport error:', err);
    res.status(500).json({ error: 'Failed to submit bug report' });
  }
}

module.exports = {
  listUsers, getUser, updateUser,
  listBugReports, updateBugReport,
  listErrorLogs, resolveErrorLog,
  logClientError, submitBugReport,
};
