// backend/src/controllers/calendarController.js
// Private, read-only iCalendar feed (Phase 1A-1).
//
// - GET /api/v1/calendar/feed/:token.ics is public (calendar apps cannot send
//   a login header): the long random token in the path is the secret. It is
//   never logged (app.js redacts it from request logs, and this handler never
//   passes errors on to the error logger, which records the path).
// - The signed-in user reads their link and can regenerate it; the old token
//   stops working at once.
// - Events: scheduled program workouts, single events and open days with a
//   date. Title, date and time only: no notes and no exercise details.
const crypto = require('crypto');
const { pool } = require('../config/database');
const { userScheduleItems } = require('./programController');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => crypto.randomBytes(32).toString('base64url');   // 256 bits, 43 chars

const TAG_LABELS = { pr_day: 'PR day', trial: 'Trial', evaluation: 'Evaluation', milestone: 'Milestone' };
const FEED_TYPES = new Set(['workout', 'single_event', 'open_day']);

/** RFC 5545 TEXT escaping. */
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets (continuation lines start with a space). */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(cur + ch, 'utf8') > limit) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const compactDate = d => d.replace(/-/g, '');
const nextDay = d => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

function eventTitle(it) {
  let label;
  if (it.day_type === 'single_event') label = it.title || 'Event';
  else if (it.day_type === 'open_day') label = it.title || 'Open day';
  else label = it.routine_name || it.title || 'Workout';
  if (it.special_tag) label += ` · ${TAG_LABELS[it.special_tag] || it.special_tag}`;
  if (!it.planned_time && it.time_of_day) label += ` (${it.time_of_day})`;
  if (it.status === 'skipped') label = `Skipped: ${label}`;
  return `${label} — ${it.program_name}`;
}

function buildIcs(items, stamp) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RipFit//Program Calendar//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:RipFit', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  ];
  for (const it of items) {
    if (!it.date || !FEED_TYPES.has(it.day_type)) continue;
    lines.push('BEGIN:VEVENT', `UID:ripfit-day-${it.program_routine_id}@ripfit`, `DTSTAMP:${stamp}`);
    if (it.planned_time) {
      // Floating local time (no zone): shown at that clock time wherever the user is.
      const [h, m] = it.planned_time.split(':').map(Number);
      const endH = Math.min(h + 1, 23); const endM = h + 1 > 23 ? 59 : m;
      lines.push(`DTSTART:${compactDate(it.date)}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`);
      lines.push(`DTEND:${compactDate(it.date)}T${String(endH).padStart(2, '0')}${String(endM).padStart(2, '0')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(it.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(it.date))}`);
    }
    lines.push(`SUMMARY:${esc(eventTitle(it))}`, `CATEGORIES:${esc(it.program_name)}`, 'TRANSP:TRANSPARENT');
    // The program color: RFC 7986 COLOR takes a CSS color name, not hex, so the
    // hex value goes in an extension property (ignored by apps that don't know it).
    if (it.color) lines.push(`X-RIPFIT-COLOR:${it.color}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** The feed link for a token, on the host the request came in on. */
function feedUrls(req, token) {
  const url = `${req.protocol}://${req.get('host')}/api/v1/calendar/feed/${token}.ics`;
  return { url, webcal_url: url.replace(/^https?:/, 'webcal:') };
}

// GET /api/v1/calendar/feed/:file  (file = <token>.ics) — no login
const getFeed = async (req, res) => {
  const token = String(req.params.file || '').replace(/\.ics$/, '');
  try {
    if (!TOKEN_RE.test(token)) return res.status(404).type('text/plain').send('Not found');
    const r = await pool.query(`SELECT user_id FROM calendar_feed_tokens WHERE token = $1`, [token]);
    if (!r.rows.length) return res.status(404).type('text/plain').send('Not found');
    const items = await userScheduleItems(pool, r.rows[0].user_id, null, null);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    res.set('Cache-Control', 'private, max-age=900');
    res.type('text/calendar; charset=utf-8').send(buildIcs(items, stamp));
  } catch (err) {
    // Logged without the request path (it holds the token).
    console.error('Calendar feed error:', err.message);
    res.status(500).type('text/plain').send('Calendar feed unavailable');
  }
};

// GET /api/v1/users/me/calendar-feed — the user's link (created on first use)
const getFeedLink = async (req, res) => {
  const uid = req.user.userId;
  try {
    await pool.query(
      `INSERT INTO calendar_feed_tokens (user_id, token) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
      [uid, newToken()]
    );
    const r = await pool.query(`SELECT token, created_at, rotated_at FROM calendar_feed_tokens WHERE user_id = $1`, [uid]);
    const { token, ...meta } = r.rows[0];
    res.json({ ...feedUrls(req, token), ...meta });
  } catch (err) {
    console.error('Calendar feed link error:', err.message);
    res.status(500).json({ error: 'Failed to get calendar link' });
  }
};

// POST /api/v1/users/me/calendar-feed/regenerate — new link; the old one stops working
const regenerateFeedLink = async (req, res) => {
  const uid = req.user.userId;
  try {
    const r = await pool.query(
      `INSERT INTO calendar_feed_tokens (user_id, token) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, rotated_at = NOW()
       RETURNING token, created_at, rotated_at`,
      [uid, newToken()]
    );
    const { token, ...meta } = r.rows[0];
    res.json({ ...feedUrls(req, token), ...meta });
  } catch (err) {
    console.error('Calendar feed regenerate error:', err.message);
    res.status(500).json({ error: 'Failed to regenerate calendar link' });
  }
};

module.exports = { getFeed, getFeedLink, regenerateFeedLink, buildIcs, TOKEN_RE };
