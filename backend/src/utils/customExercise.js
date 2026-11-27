// The custom exercise rule (shared by find-or-create and, since Phase 1A-1,
// program create/update): match an existing exercise by its trimmed name,
// case-insensitive; otherwise create a minimal custom exercise owned by the user.
// exercises.name has no unique constraint, so this looks up first.

/** Trims and collapses spaces; '' when not a string. */
const cleanExerciseName = raw => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '');

async function findOrCreateExerciseByName(db, name, userId, { category = null, equipmentType = null } = {}) {
  const existing = await db.query(
    `SELECT id, name, category, equipment_type, source
     FROM exercises WHERE LOWER(name) = LOWER($1)
     ORDER BY id LIMIT 1`,
    [name]
  );
  if (existing.rows.length > 0) return { ...existing.rows[0], created: false };
  const inserted = await db.query(
    `INSERT INTO exercises (name, category, equipment_type, source, is_custom, created_by_user_id)
     VALUES ($1, COALESCE($2, 'General'), $3, 'user_generated', TRUE, $4)
     RETURNING id, name, category, equipment_type, source`,
    [name, category, equipmentType, userId]
  );
  return { ...inserted.rows[0], created: true };
}

module.exports = { cleanExerciseName, findOrCreateExerciseByName };
