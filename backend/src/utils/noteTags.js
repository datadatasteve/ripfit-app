// Rules-based note tags (Phase 1A-2).
//
// TAG_KEYWORDS is the one place to tweak: each tag lists words or phrases.
// Matching is case-insensitive on whole words ("pr" matches "New PR!" but not
// "press"). A note gets every tag whose list has a match.
//
// Where notes live (audit G2):
//   workouts.overall_notes          → source_type 'workout_overall' (id = workout id)
//   workouts.session_notes          → 'workout_session' (the rating note)
//   workout_exercises.exercise_notes → 'exercise' (id = workout_exercises.id); one
//       note per line, "Set N: …" lines are set notes (set_number = N),
//       "General: …" lines are exercise notes
//   workout_cardio_segments.notes   → 'segment' (id = segment id)
// Tags are rebuilt for a source every time its note is saved.

const TAG_KEYWORDS = {
  pain: ['pain', 'painful', 'hurt', 'hurts', 'hurting', 'ache', 'aches', 'aching', 'achy', 'sharp', 'twinge',
    'tweak', 'tweaked', 'pinch', 'pinched', 'injury', 'injured', 'strain', 'strained', 'sprain', 'tendon', 'numb', 'tingling'],
  form: ['form', 'technique', 'depth', 'lockout', 'elbow flare', 'flared', 'grip', 'posture', 'cue', 'cues', 'rounded',
    'rounding', 'arch', 'bar path', 'range of motion', 'rom', 'tempo', 'butt wink', 'knees caved', 'brace', 'bracing'],
  fatigue: ['tired', 'fatigue', 'fatigued', 'exhausted', 'gassed', 'drained', 'sore', 'soreness', 'doms', 'heavy legs',
    'burnt out', 'burned out', 'no energy', 'low energy', 'sluggish', 'wiped'],
  pr: ['pr', 'prs', 'personal record', 'personal best', 'pb', 'new max', 'all-time best', 'lifetime best'],
  equipment: ['equipment', 'machine taken', 'rack taken', 'bench taken', 'broken', 'out of order', 'occupied', 'busy gym',
    'no rack', 'missing plates', 'belt', 'straps', 'wraps', 'sleeves', 'chalk', 'shoes', 'different gym'],
  sleep: ['sleep', 'slept', 'sleeping', 'insomnia', 'nap', 'napped', 'up late', 'woke up', 'restless night', 'well rested'],
  mood: ['mood', 'stressed', 'stress', 'anxious', 'anxiety', 'happy', 'motivated', 'unmotivated', 'angry', 'sad',
    'frustrated', 'focused', 'distracted', 'great day', 'bad day', 'irritable', 'confident'],
  nutrition: ['ate', 'eat', 'eating', 'meal', 'food', 'hungry', 'fasted', 'fasting', 'protein', 'carbs', 'caffeine',
    'coffee', 'hydrated', 'dehydrated', 'water', 'pre-workout', 'preworkout', 'snack', 'breakfast', 'lunch', 'dinner'],
};

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match; a phrase's inner spaces match any run of spaces.
const MATCHERS = Object.entries(TAG_KEYWORDS).map(([tag, words]) => ({
  tag,
  re: new RegExp(`(^|[^a-z0-9])(${words.map(w => escapeRe(w.toLowerCase()).replace(/ /g, '\\s+')).join('|')})(?=$|[^a-z0-9])`, 'i'),
}));

/** [{ tag, keyword }] for one piece of text. */
function tagsFor(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const { tag, re } of MATCHERS) {
    const m = text.match(re);
    if (m) out.push({ tag, keyword: m[2].toLowerCase().replace(/\s+/g, ' ') });
  }
  return out;
}

/** Splits a note into taggable lines: [{ line_number, set_number, text }]. */
function linesOf(sourceType, text) {
  if (!text) return [];
  if (sourceType !== 'exercise') return [{ line_number: 0, set_number: null, text }];
  return String(text).split('\n').map((line, i) => {
    const set = line.match(/^Set (\d+):\s*(.*)$/);
    const general = line.match(/^General:\s*(.*)$/);
    return {
      line_number: i + 1,
      set_number: set ? Number(set[1]) : null,
      text: set ? set[2] : general ? general[1] : line,
    };
  }).filter(l => l.text.trim());
}

/**
 * Rebuilds the tags of one note. `db` may be a pool or a transaction client.
 * Returns the tags written ([{ tag, keyword, line_number, set_number }]).
 */
async function retag(db, { userId, workoutId = null, sourceType, sourceId, text }) {
  await db.query(`DELETE FROM note_tags WHERE source_type = $1 AND source_id = $2`, [sourceType, sourceId]);
  const written = [];
  for (const line of linesOf(sourceType, text)) {
    for (const { tag, keyword } of tagsFor(line.text)) {
      await db.query(
        `INSERT INTO note_tags (user_id, workout_id, source_type, source_id, line_number, set_number, tag, matched_keyword)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [userId, workoutId, sourceType, sourceId, line.line_number, line.set_number, tag, keyword]
      );
      written.push({ tag, keyword, line_number: line.line_number, set_number: line.set_number });
    }
  }
  return written;
}

/** Same as retag, but never fails the caller's request (tags are a side effect of saving a note). */
async function retagSafely(db, args) {
  try {
    return await retag(db, args);
  } catch (err) {
    console.error('Note tagging failed:', err.message);
    return [];
  }
}

module.exports = { TAG_KEYWORDS, tagsFor, linesOf, retag, retagSafely };
