// ============================================================================
// Cardio Controller
// ============================================================================
const { pool } = require('../config/database');

const CARDIO_TYPES = [
  'Indoor Cycling',
  'Outdoor Cycling',
  'Treadmill',
  'Outdoor Running',
  'Indoor Track',
  'Walking',
  'Hiking',
  'Elliptical',
  'Rowing Machine',
  'Swimming',
  'Jump Rope',
  'Stair Climber',
  'HIIT',
  'Sprints',
  'Suicides',
];

// GET /api/v1/cardio/types
const getCardioTypes = (req, res) => {
  res.json({ types: CARDIO_TYPES });
};

// POST /api/v1/cardio/start
// Body: { cardio_type, goal_duration_seconds?, goal_distance?, goal_distance_unit?, goal_speed? }
const startSession = async (req, res) => {
  const user_id = req.user.userId;
  const {
    cardio_type,
    goal_duration_seconds,
    goal_distance,
    goal_distance_unit,
    goal_speed,
    pre_session_notes,
  } = req.body;

  if (!cardio_type) {
    return res.status(400).json({ error: 'cardio_type is required' });
  }
  if (!CARDIO_TYPES.includes(cardio_type)) {
    return res.status(400).json({ error: 'Invalid cardio_type' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO cardio_sessions (
        user_id, session_date, cardio_type, start_time,
        goal_duration_seconds, goal_distance, goal_distance_unit, goal_speed,
        pre_session_notes, status
      ) VALUES ($1, CURRENT_DATE, $2, NOW(), $3, $4, $5, $6, $7, 'in_progress')
      RETURNING *`,
      [user_id, cardio_type, goal_duration_seconds || null, goal_distance || null,
       goal_distance_unit || 'mi', goal_speed || null, pre_session_notes || null]
    );
    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('Start cardio session error:', err);
    res.status(500).json({ error: 'Failed to start cardio session' });
  }
};

// PUT /api/v1/cardio/:id/notes
// Body: { mid_session_notes }
const updateNotes = async (req, res) => {
  const user_id = req.user.userId;
  const { id } = req.params;
  const { mid_session_notes } = req.body;

  try {
    const result = await pool.query(
      `UPDATE cardio_sessions SET mid_session_notes = $1
       WHERE id = $2 AND user_id = $3 RETURNING id`,
      [mid_session_notes, id, user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ message: 'Notes updated' });
  } catch (err) {
    console.error('Update cardio notes error:', err);
    res.status(500).json({ error: 'Failed to update notes' });
  }
};

// PUT /api/v1/cardio/:id/finish
// Body: all optional metric fields + post_session_notes
const finishSession = async (req, res) => {
  const user_id = req.user.userId;
  const { id } = req.params;
  const {
    duration_seconds,
    distance, distance_unit,
    avg_heart_rate, max_heart_rate,
    calories_burned,
    avg_speed, max_speed,
    elevation_gain,
    hr_zone_1_seconds, hr_zone_2_seconds, hr_zone_3_seconds,
    hr_zone_4_seconds, hr_zone_5_seconds,
    post_session_notes,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE cardio_sessions SET
        end_time = NOW(),
        status = 'completed',
        duration_seconds = $1,
        distance = $2, distance_unit = $3,
        avg_heart_rate = $4, max_heart_rate = $5,
        calories_burned = $6,
        avg_speed = $7, max_speed = $8,
        elevation_gain = $9,
        hr_zone_1_seconds = $10, hr_zone_2_seconds = $11,
        hr_zone_3_seconds = $12, hr_zone_4_seconds = $13,
        hr_zone_5_seconds = $14,
        post_session_notes = $15
       WHERE id = $16 AND user_id = $17
       RETURNING *`,
      [
        duration_seconds || null,
        distance || null, distance_unit || 'mi',
        avg_heart_rate || null, max_heart_rate || null,
        calories_burned || null,
        avg_speed || null, max_speed || null,
        elevation_gain || null,
        hr_zone_1_seconds || null, hr_zone_2_seconds || null,
        hr_zone_3_seconds || null, hr_zone_4_seconds || null,
        hr_zone_5_seconds || null,
        post_session_notes || null,
        id, user_id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('Finish cardio session error:', err);
    res.status(500).json({ error: 'Failed to finish cardio session' });
  }
};

// PUT /api/v1/cardio/:id/cancel
const cancelSession = async (req, res) => {
  const user_id = req.user.userId;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE cardio_sessions SET status = 'cancelled', end_time = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ message: 'Session cancelled' });
  } catch (err) {
    console.error('Cancel cardio session error:', err);
    res.status(500).json({ error: 'Failed to cancel session' });
  }
};

// GET /api/v1/cardio/history
const getHistory = async (req, res) => {
  const user_id = req.user.userId;
  const { limit = 20, offset = 0 } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM cardio_sessions
       WHERE user_id = $1 AND status = 'completed'
       ORDER BY session_date DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Cardio history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
};

module.exports = {
  getCardioTypes,
  startSession,
  updateNotes,
  finishSession,
  cancelSession,
  getHistory,
};
