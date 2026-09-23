import { useState, useEffect, useRef } from 'react';
import {
  primeAudio, playMeditationBowl, loadMeditationSound, saveMeditationSound, DEFAULT_MEDITATION_SOUND,
} from './audioCues';
import SortableList, { newRowKey } from './SortableList';
import { useUserPrefs } from '../contexts/UserPrefsContext';
import './MeditationTimer.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const PRESETS_KEY = 'ripfit_meditation_presets';

const DEFAULT_SEGMENTS = [
  { name: 'Meditation', seconds: 21 * 60 },
  { name: 'Coming Out', seconds: 2 * 60 },
];

// Sentinel option value for the built-in default; saved preset names are free text.
const DEFAULT_PRESET_VALUE = '__default__';

// Presets hand out fresh objects so editing a row never mutates the source,
// each with its own _key for drag reordering. Keys are stripped before storage.
const copySegments = (segs) => segs.map(s => ({ ...s, _key: newRowKey() }));
const storableSegments = (segs) => segs.map(({ name, seconds }) => ({ name, seconds }));

// Offered in the setup screen but not enabled by default.
const OPTIONAL_SEGMENTS = [
  { name: 'Pranayama', seconds: 5 * 60 },
  { name: 'Yoga Asanas', seconds: 15 * 60 },
];

function mmss(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePresets(presets) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    /* storage unavailable — presets simply don't persist */
  }
}

/** One editable row in the segment list. */
function SegmentRow({ segment, index, total, onChange, onMove, onRemove, handle }) {
  const mins = Math.floor(segment.seconds / 60);
  const secs = segment.seconds % 60;

  const setDuration = (m, s) => {
    const next = Math.max(1, (parseInt(m) || 0) * 60 + (parseInt(s) || 0));
    onChange({ ...segment, seconds: next });
  };

  return (
    <div className="mt-seg-row">
      {handle}
      <input
        className="mt-seg-name"
        type="text"
        value={segment.name}
        onChange={e => onChange({ ...segment, name: e.target.value })}
        aria-label={`Segment ${index + 1} name`}
      />
      <div className="mt-seg-duration">
        <input
          type="number" inputMode="numeric" min="0" value={mins}
          onChange={e => setDuration(e.target.value, secs)}
          aria-label="Minutes"
        />
        <span>:</span>
        <input
          type="number" inputMode="numeric" min="0" max="59" value={String(secs).padStart(2, '0')}
          onChange={e => setDuration(mins, e.target.value)}
          aria-label="Seconds"
        />
      </div>
      <div className="mt-seg-actions">
        {!handle && (
          <>
            <button onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label="Move up">↑</button>
            <button onClick={() => onMove(index, index + 1)} disabled={index === total - 1} aria-label="Move down">↓</button>
          </>
        )}
        <button onClick={() => onRemove(index)} className="mt-seg-remove" aria-label="Remove segment">×</button>
      </div>
    </div>
  );
}

// ── Stoic quotes ───────────────────────────────────────────────────────────
// Public-domain translations only: George Long (Marcus Aurelius, 1862;
// Epictetus, 1877) and Richard M. Gummere (Seneca's Letters, 1917–25).
// Rotated sequentially — never randomised — via ripfit_stoic_quote_idx.
const STOIC_QUOTES = [
  { text: 'The soul is dyed by the thoughts.', author: 'Marcus Aurelius' },
  { text: 'The universe is transformation: life is opinion.', author: 'Marcus Aurelius' },
  { text: 'Look within. Within is the fountain of good, and it will ever bubble up, if thou wilt ever dig.', author: 'Marcus Aurelius' },
  { text: 'Be like the promontory against which the waves continually break, but it stands firm and tames the fury of the water around it.', author: 'Marcus Aurelius' },
  { text: 'If thou art pained by any external thing, it is not this thing that disturbs thee, but thy own judgement about it.', author: 'Marcus Aurelius' },
  { text: 'No longer talk at all about the kind of man that a good man ought to be, but be such.', author: 'Marcus Aurelius' },
  { text: 'Nowhere either with more quiet or more freedom from trouble does a man retire than into his own soul.', author: 'Marcus Aurelius' },
  { text: 'The best way of avenging thyself is not to become like the wrong doer.', author: 'Marcus Aurelius' },
  { text: 'Since it is possible that thou mayest depart from life this very moment, regulate every act and thought accordingly.', author: 'Marcus Aurelius' },
  { text: 'Let not future things disturb thee, for thou wilt come to them, if it shall be necessary, having with thee the same reason which now thou usest for present things.', author: 'Marcus Aurelius' },
  { text: 'Very little indeed is necessary for living a happy life.', author: 'Marcus Aurelius' },
  { text: 'Do every act of thy life as if it were the last.', author: 'Marcus Aurelius' },
  { text: 'Men are disturbed not by the things which happen, but by the opinions about the things.', author: 'Epictetus' },
  { text: 'Of things some are in our power, and others are not.', author: 'Epictetus' },
  { text: 'Seek not that the things which happen should happen as you wish; but wish the things which happen to be as they are, and you will have a tranquil flow of life.', author: 'Epictetus' },
  { text: 'It is difficulties which show what men are.', author: 'Epictetus' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus' },
  { text: 'If you would be a good reader, read; if a writer, write.', author: 'Epictetus' },
  { text: 'Hold every hour in your grasp. Lay hold of to-day’s task, and you will not need to depend so much upon to-morrow’s.', author: 'Seneca' },
  { text: 'Nothing, Lucilius, is ours, except time.', author: 'Seneca' },
  { text: 'It is not the man who has too little, but the man who craves more, that is poor.', author: 'Seneca' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'There are more things, Lucilius, likely to frighten us than there are to crush us.', author: 'Seneca' },
  { text: 'You need a change of soul rather than a change of climate.', author: 'Seneca' },
  { text: 'When a man does not know what harbour he is making for, no wind is the right wind.', author: 'Seneca' },
];

const QUOTE_IDX_KEY = 'ripfit_stoic_quote_idx';

/** Returns the next quote in sequence and advances the stored index (wraps). */
function nextStoicQuote() {
  let idx = 0;
  try {
    idx = parseInt(localStorage.getItem(QUOTE_IDX_KEY), 10);
    if (!Number.isInteger(idx) || idx < 0) idx = 0;
    localStorage.setItem(QUOTE_IDX_KEY, String((idx + 1) % STOIC_QUOTES.length));
  } catch {
    /* storage unavailable — still show a quote */
  }
  return STOIC_QUOTES[idx % STOIC_QUOTES.length];
}

function StoicQuote({ quote, className = '' }) {
  if (!quote) return null;
  return (
    <figure className={`mt-quote ${className}`}>
      <blockquote>{quote.text}</blockquote>
      <figcaption>— {quote.author}</figcaption>
    </figure>
  );
}

// ── Sound settings (mixing board) ──────────────────────────────────────────

/** Labelled range input with its live value. Module-scope so it never remounts. */
function Slider({ label, value, min, max, step = 1, unit = '', onChange, disabled, format }) {
  return (
    <label className={`mt-slider ${disabled ? 'disabled' : ''}`}>
      <span className="mt-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="mt-slider-value">{format ? format(value) : `${value}${unit}`}</span>
    </label>
  );
}

const signedDb = v => `${v > 0 ? '+' : ''}${v} dB`;

function SoundSettings({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const set = patch => onChange({ ...settings, ...patch });
  const setExtra = (key, patch) => onChange({ ...settings, [key]: { ...settings[key], ...patch } });
  const setEq = patch => onChange({ ...settings, eq: { ...settings.eq, ...patch } });

  return (
    <div className="mt-sound">
      <button type="button" className="mt-sound-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        Sound Settings {open ? '▾' : '▸'}
      </button>

      {open && (
        <div className="mt-sound-panel">
          <section>
            <h4>Tone</h4>
            <Slider label="Fundamental" value={settings.fundamental} min={200} max={800} unit=" Hz"
              onChange={v => set({ fundamental: v })} />
            {['extra1', 'extra2'].map((key, i) => (
              <div key={key} className="mt-extra-pitch">
                <label className="mt-check">
                  <input type="checkbox" checked={settings[key].enabled}
                    onChange={e => setExtra(key, { enabled: e.target.checked })} />
                  Additional pitch {i + 1}
                </label>
                <Slider label="" value={settings[key].freq} min={200} max={800} unit=" Hz"
                  disabled={!settings[key].enabled} onChange={v => setExtra(key, { freq: v })} />
              </div>
            ))}
          </section>

          <section>
            <h4>Envelope</h4>
            <Slider label="Attack" value={settings.attackMs} min={10} max={200} step={5} unit=" ms"
              onChange={v => set({ attackMs: v })} />
            <Slider label="Initial decay" value={settings.decayMs} min={50} max={500} step={10} unit=" ms"
              onChange={v => set({ decayMs: v })} />
            <Slider label="Ring-out" value={settings.ringOutMs} min={1000} max={8000} step={100} unit=" ms"
              onChange={v => set({ ringOutMs: v })} />
          </section>

          <section>
            <h4>Ring behavior</h4>
            <Slider label="Volume" value={settings.volume} min={0} max={100} unit="%"
              onChange={v => set({ volume: v })} />
            <Slider label="Ring count" value={settings.ringCount} min={1} max={5}
              onChange={v => set({ ringCount: v })} />
            {settings.ringCount > 1 && (
              <Slider label="Ring interval" value={settings.ringIntervalMs} min={300} max={3000} step={100} unit=" ms"
                onChange={v => set({ ringIntervalMs: v })} />
            )}
            <label className="mt-field">
              <span>Ring timing</span>
              <select value={settings.ringTiming} onChange={e => set({ ringTiming: e.target.value })}>
                <option value="session">Per session end</option>
                <option value="segment">Per segment end</option>
                <option value="interval">Every N minutes</option>
              </select>
            </label>
            {settings.ringTiming === 'interval' && (
              <label className="mt-field">
                <span>Every N minutes</span>
                <input type="number" inputMode="numeric" min="1" value={settings.intervalMinutes}
                  onChange={e => set({ intervalMinutes: e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  onBlur={() => { if (!settings.intervalMinutes) set({ intervalMinutes: 1 }); }} />
              </label>
            )}
          </section>

          <section>
            <h4>EQ</h4>
            <Slider label="Low (200 Hz)" value={settings.eq.low} min={-12} max={12} format={signedDb}
              onChange={v => setEq({ low: v })} />
            <Slider label="Mid (1 kHz)" value={settings.eq.mid} min={-12} max={12} format={signedDb}
              onChange={v => setEq({ mid: v })} />
            <Slider label="High (5 kHz)" value={settings.eq.high} min={-12} max={12} format={signedDb}
              onChange={v => setEq({ high: v })} />
          </section>

          <section>
            <h4>Effects</h4>
            <Slider label="Reverb" value={settings.reverb} min={0} max={100} unit="%"
              onChange={v => set({ reverb: v })} />
            <Slider label="Chorus" value={settings.chorus} min={0} max={100} unit="%"
              onChange={v => set({ chorus: v })} />
          </section>

          <div className="mt-sound-actions">
            <button type="button" className="mt-btn mt-btn-sm" onClick={() => { primeAudio(); playMeditationBowl(settings); }}>
              ▶ Test sound
            </button>
            <button type="button" className="mt-btn mt-btn-sm" onClick={() => onChange(structuredClone(DEFAULT_MEDITATION_SOUND))}>
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presets ────────────────────────────────────────────────────────────────

/**
 * Preset list: Default plus saved presets, each with Edit, Rename and Delete.
 * Tapping a name loads it; Edit loads it and pre-fills the save name so saving
 * overwrites that preset.
 */
function PresetList({ presets, activePreset, onLoad, onEdit, onRename, onDelete }) {
  const [renaming, setRenaming] = useState(null);   // preset name being renamed
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');

  const startRename = (name) => { setRenaming(name); setDraftName(name); setError(''); };
  const commitRename = () => {
    const next = draftName.trim();
    if (!next) { setError('Name can’t be empty.'); return; }
    if (next !== renaming && presets.some(p => p.name === next)) { setError('A preset with that name exists.'); return; }
    onRename(renaming, next);
    setRenaming(null);
  };

  return (
    <div className="mt-presets">
      <div className="mt-presets-head">Presets</div>
      <ul className="mt-preset-list">
        <li className={`mt-preset-item ${!activePreset ? 'active' : ''}`}>
          <button type="button" className="mt-preset-name" onClick={() => onLoad(DEFAULT_PRESET_VALUE)}>
            Default <span className="mt-preset-sub">Meditation + Coming Out</span>
          </button>
        </li>
        {presets.map(p => (
          <li key={p.name} className={`mt-preset-item ${activePreset === p.name ? 'active' : ''}`}>
            {renaming === p.name ? (
              <div className="mt-preset-rename">
                <input type="text" value={draftName} autoFocus aria-label="New preset name"
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
                <button type="button" className="mt-btn mt-btn-sm mt-btn-primary" onClick={commitRename}>Save</button>
                <button type="button" className="mt-btn mt-btn-sm" onClick={() => setRenaming(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <button type="button" className="mt-preset-name" onClick={() => onLoad(p.name)}>
                  {p.name}
                  <span className="mt-preset-sub">{mmss(p.segments.reduce((a, s) => a + s.seconds, 0))}</span>
                </button>
                <div className="mt-preset-actions">
                  <button type="button" onClick={() => onEdit(p.name)} title="Load into the editor to change it">Edit</button>
                  <button type="button" onClick={() => startRename(p.name)}>Rename</button>
                  <button type="button" className="danger" onClick={() => onDelete(p.name)}>Delete</button>
                </div>
              </>
            )}
            {renaming === p.name && error && <p className="mt-error">{error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Seconds left in the current segment of a running or paused session. */
function segmentRemaining(session) {
  if (!session) return 0;
  if (session.status === 'paused') return session.pausedRemaining ?? 0;
  if (session.status === 'running') {
    return Math.max(0, Math.ceil((session.segEndsAt - Date.now()) / 1000));
  }
  return 0;
}

export { segmentRemaining };

/**
 * Drives a meditation session whose state lives above the timer view.
 *
 * Call this once from App so segments advance, bowls ring and the screen stays
 * awake even while the user is on another tab and MeditationTimer is not
 * mounted. The session is plain data (see MeditationTimer) with wall-clock
 * deadlines, so nothing here depends on the view being on screen.
 */
export function useMeditationEngine(session, setSession) {
  // Read the latest session from a ref so the interval never goes stale and
  // never needs re-creating on each state change.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const status = session?.status;

  useEffect(() => {
    if (status !== 'running') return undefined;

    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s || s.status !== 'running') return;
      const now = Date.now();
      const timing = s.ringTiming || 'segment';
      let next = s;
      let ring = false;

      // "Every N minutes": measured in meditating time (pauses shift it).
      if (timing === 'interval' && s.nextRingAt && now >= s.nextRingAt) {
        let at = s.nextRingAt;
        while (now >= at) at += s.intervalMs;
        next = { ...next, nextRingAt: at };
        ring = true;
      }

      if (now >= s.segEndsAt) {
        // Catch up across every boundary that passed — a backgrounded tab can
        // sleep through more than one segment. One ring covers them all.
        let idx = s.segIdx;
        let endsAt = s.segEndsAt;
        while (now >= endsAt && idx < s.segments.length - 1) {
          idx += 1;
          endsAt += s.segments[idx].seconds * 1000;
        }
        if (now >= endsAt) {
          next = { ...next, segIdx: s.segments.length - 1, status: 'done', segEndsAt: null, endedAt: endsAt };
          ring = true;   // the session end rings in every timing mode
        } else {
          next = { ...next, segIdx: idx, segEndsAt: endsAt };
          if (timing === 'segment') ring = true;
        }
      }

      if (next !== s) {
        sessionRef.current = next;   // guard against a second tick before re-render
        setSession(next);
      }
      if (ring) playMeditationBowl();
    }, 250);

    return () => clearInterval(id);
  }, [status, setSession]);

  // Wake lock follows the session, not the view. Best-effort only.
  useEffect(() => {
    if (status !== 'running') return undefined;
    let lock = null;
    let cancelled = false;
    (async () => {
      try {
        if (navigator.wakeLock?.request) {
          lock = await navigator.wakeLock.request('screen');
          if (cancelled) lock.release?.();
        }
      } catch {
        /* not supported or denied — session still runs */
      }
    })();
    return () => {
      cancelled = true;
      try { lock?.release?.(); } catch { /* ignore */ }
    };
  }, [status]);
}

/**
 * Standalone multi-segment meditation timer.
 *
 * Setup (segments, presets) is local to this view. Once started, the session is
 * held by App as `session` / `setSession` and advanced by useMeditationEngine,
 * so it survives navigating to another tab:
 *
 *   { segments, presetName, segIdx, status: 'running' | 'paused' | 'done',
 *     segEndsAt, pausedRemaining, startedAt, endedAt }
 *
 * Segments run back to back; each one ends with a singing-bowl tone. The
 * session is logged as a workout with workout_type 'meditation', which keeps
 * it out of the strength and cardio stats queries.
 */
export default function MeditationTimer({ session, setSession, onClose }) {
  const { prefs } = useUserPrefs();
  const [segments, setSegments] = useState(() => copySegments(DEFAULT_SEGMENTS));
  const [sound, setSound] = useState(loadMeditationSound);
  const [sessionNotes, setSessionNotes] = useState('');
  const [transitionQuote, setTransitionQuote] = useState(null);
  const lastSegIdxRef = useRef(session?.segIdx ?? null);
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [activePreset, setActivePreset] = useState('');
  const [newPresetName, setNewPresetName] = useState('');
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved' | 'error'

  // Re-render while running so the clock stays live. Time itself always comes
  // from session.segEndsAt, never from this tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (session?.status !== 'running') return undefined;
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [session?.status]);

  const totalSeconds = segments.reduce((sum, s) => sum + s.seconds, 0);

  const updateSound = (next) => { setSound(next); saveMeditationSound(next); };

  // A quote at each segment change, shown ~3 s then faded. Only changes seen
  // while this view is mounted count; returning to a running session doesn't
  // replay one.
  const segIdx = session?.segIdx;
  const sessionStatus = session?.status;
  useEffect(() => {
    const prev = lastSegIdxRef.current;
    lastSegIdxRef.current = segIdx ?? null;
    if (sessionStatus !== 'running' || prev === null || segIdx === undefined || segIdx === prev) return undefined;
    setTransitionQuote(nextStoicQuote());
    const t = setTimeout(() => setTransitionQuote(null), 3500);
    return () => clearTimeout(t);
  }, [segIdx, sessionStatus]);

  // The completion quote is stored on the session so it stays the same if the
  // user leaves and comes back to the finished screen.
  useEffect(() => {
    if (session?.status === 'done' && !session.doneQuote) {
      setSession({ ...session, doneQuote: nextStoicQuote() });
    }
  }, [session, setSession]);

  // ── Segment list editing ──
  const updateSegment = (i, next) => setSegments(segs => segs.map((s, idx) => (idx === i ? next : s)));
  const removeSegment = (i) => setSegments(segs => segs.filter((_, idx) => idx !== i));
  const moveSegment = (from, to) => {
    if (to < 0 || to >= segments.length) return;
    setSegments(segs => {
      const copy = [...segs];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  };
  const addSegment = (seg) => setSegments(segs => [...segs, { ...(seg || { name: 'New segment', seconds: 5 * 60 }), _key: newRowKey() }]);

  // Always overwrites the current list — including when it is empty, and when
  // the chosen preset is the one already applied.
  const applyPreset = (value) => {
    if (value === DEFAULT_PRESET_VALUE) {
      setSegments(copySegments(DEFAULT_SEGMENTS));
      setActivePreset('');
      setPresetName('');
      return;
    }
    const preset = presets.find(p => p.name === value);
    if (!preset) return;
    setSegments(copySegments(preset.segments));
    setActivePreset(preset.name);
    setPresetName(preset.name);
  };

  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const next = [...presets.filter(p => p.name !== name), { name, segments: storableSegments(segments) }];
    setPresets(next);
    savePresets(next);
    setActivePreset(name);
    setPresetName(name);
    setNewPresetName('');
  };

  const handleDeletePreset = (name) => {
    if (!window.confirm(`Delete '${name}'?`)) return;
    const next = presets.filter(p => p.name !== name);
    setPresets(next);
    savePresets(next);
    if (activePreset === name) { setActivePreset(''); setPresetName(''); }
  };

  const handleRenamePreset = (oldName, newName) => {
    const next = presets.map(p => (p.name === oldName ? { ...p, name: newName } : p));
    setPresets(next);
    savePresets(next);
    if (activePreset === oldName) { setActivePreset(newName); setPresetName(newName); }
    if (newPresetName === oldName) setNewPresetName(newName);
  };

  // Edit = load into the editor and pre-fill the save name, so Save overwrites it.
  const handleEditPreset = (name) => {
    applyPreset(name);
    setNewPresetName(name);
  };

  // ── Session controls — all write the lifted session ──
  const startSession = () => {
    if (segments.length === 0) return;
    // A user gesture is required before WebAudio will play; priming here means
    // the first bowl is audible even if it rings while on another tab.
    primeAudio();
    const now = Date.now();
    const intervalMs = Math.max(1, parseInt(sound.intervalMinutes, 10) || 1) * 60000;
    setSaveState('');
    setSessionNotes('');
    setSession({
      segments: copySegments(segments),
      presetName,
      segIdx: 0,
      status: 'running',
      segEndsAt: now + segments[0].seconds * 1000,
      pausedRemaining: null,
      startedAt: now,
      endedAt: null,
      pausedAt: null,
      pausedMs: 0,
      ringTiming: sound.ringTiming,
      intervalMs,
      nextRingAt: sound.ringTiming === 'interval' ? now + intervalMs : null,
    });
  };

  const togglePause = () => {
    const now = Date.now();
    if (session.status === 'paused') {
      const pausedFor = session.pausedAt ? now - session.pausedAt : 0;
      setSession({
        ...session,
        status: 'running',
        segEndsAt: now + (session.pausedRemaining ?? 0) * 1000,
        pausedRemaining: null,
        pausedAt: null,
        pausedMs: (session.pausedMs || 0) + pausedFor,
        nextRingAt: session.nextRingAt ? session.nextRingAt + pausedFor : null,
      });
    } else {
      setSession({
        ...session,
        status: 'paused',
        pausedRemaining: segmentRemaining(session),
        segEndsAt: null,
        pausedAt: now,
      });
    }
  };

  // Paused time so far, including a pause that's still open.
  const pausedSoFar = (s, now) => (s.pausedMs || 0) + (s.pausedAt ? now - s.pausedAt : 0);

  const skipSegment = () => {
    const last = session.segments.length - 1;
    const timing = session.ringTiming || 'segment';
    if (timing === 'segment' || session.segIdx >= last) playMeditationBowl();
    if (session.segIdx < last) {
      const nextIdx = session.segIdx + 1;
      const nextSeconds = session.segments[nextIdx].seconds;
      setSession({
        ...session,
        segIdx: nextIdx,
        segEndsAt: session.status === 'paused' ? null : Date.now() + nextSeconds * 1000,
        pausedRemaining: session.status === 'paused' ? nextSeconds : null,
      });
    } else {
      const now = Date.now();
      setSession({ ...session, status: 'done', segEndsAt: null, pausedRemaining: null,
        endedAt: now, pausedMs: pausedSoFar(session, now), pausedAt: null });
    }
  };

  const endEarly = () => {
    const now = Date.now();
    setSession({ ...session, status: 'done', segEndsAt: null, pausedRemaining: null,
      endedAt: now, pausedMs: pausedSoFar(session, now), pausedAt: null });
  };

  // Meditating time: wall-clock span minus paused time.
  const activeSeconds = (s) => Math.max(0, Math.round(
    ((s.endedAt ?? Date.now()) - s.startedAt - pausedSoFar(s, s.endedAt ?? Date.now())) / 1000
  ));

  // Leaving the done screen is the explicit exit that clears the session.
  const startNewSession = () => {
    setSegments(copySegments(session.segments));
    setPresetName(session.presetName || '');
    setSaveState('');
    setSessionNotes('');
    setSession(null);
  };

  const finish = () => {
    setSession(null);
    onClose();
  };

  /** Log the finished session as a meditation workout. */
  const logSession = async () => {
    setSaveState('saving');
    const elapsed = activeSeconds(session);
    const breakdown = session.segments.map(s => `${s.name} — ${mmss(s.seconds)}`).join('\n');
    const notes = [
      session.presetName ? `Preset: ${session.presetName}` : null,
      `Total: ${mmss(elapsed)}`,
      'Segments:',
      breakdown,
      // The user's own notes go after the automatic breakdown.
      sessionNotes.trim() ? `\nSession notes:\n${sessionNotes.trim()}` : null,
    ].filter(Boolean).join('\n');

    try {
      const tok = localStorage.getItem('ripfit_token');
      const now = new Date();
      const workoutDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const startRes = await fetch(`${API_BASE}/workouts/start-free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          workout_date: workoutDate,
          workout_title: session.presetName || 'Meditation',
          workout_type: 'meditation',
        }),
      });
      if (!startRes.ok) throw new Error('start failed');
      const started = await startRes.json();
      const id = started.workout.id;

      await fetch(`${API_BASE}/workouts/${id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ overall_notes: notes }),
      });

      // Explicit duration: this runs after the session, so the workout's own
      // start/end timestamps are seconds apart.
      await fetch(`${API_BASE}/workouts/${id}/finish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ duration_seconds: elapsed }),
      });

      setSaveState('saved');
    } catch (err) {
      console.error('Failed to log meditation session:', err);
      setSaveState('error');
    }
  };

  // ── Running / paused ──
  if (session && session.status !== 'done') {
    const current = session.segments[session.segIdx];
    const remaining = segmentRemaining(session);
    const paused = session.status === 'paused';
    const pct = current.seconds > 0 ? ((current.seconds - remaining) / current.seconds) * 100 : 0;

    return (
      <div className="mt-container mt-running">
        <div className="mt-run-segment">{current.name}</div>
        <div className="mt-run-clock">{mmss(remaining)}</div>
        <div className="mt-run-progress">
          <div className="mt-run-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-run-meta">
          Segment {session.segIdx + 1} of {session.segments.length}
          {paused && <span className="mt-run-paused"> · paused</span>}
        </div>

        {transitionQuote && <StoicQuote quote={transitionQuote} className="mt-quote-transition" />}

        <div className="mt-run-actions">
          <button className="mt-btn mt-btn-primary" onClick={togglePause}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="mt-btn" onClick={skipSegment}>Skip Segment</button>
          <button className="mt-btn" onClick={endEarly}>End Session</button>
        </div>
      </div>
    );
  }

  // ── Finished ──
  if (session && session.status === 'done') {
    const elapsed = activeSeconds(session);
    return (
      <div className="mt-container">
        <h2 className="mt-title">Session complete</h2>
        <p className="mt-done-total">{mmss(elapsed)}</p>
        <StoicQuote quote={session.doneQuote} className="mt-quote-done" />
        {session.presetName && <p className="mt-subtle">Preset: {session.presetName}</p>}

        <div className="mt-done-breakdown">
          {session.segments.map((s, i) => (
            <div key={i} className="mt-done-row"><span>{s.name}</span><span>{mmss(s.seconds)}</span></div>
          ))}
        </div>

        <label className="mt-notes">
          <span>How was your session?</span>
          <textarea
            rows="3"
            value={sessionNotes}
            onChange={e => setSessionNotes(e.target.value)}
            disabled={saveState === 'saved'}
            placeholder="Optional — saved with the session"
          />
        </label>

        {saveState === 'saved' ? (
          <p className="mt-saved">Logged to your session history.</p>
        ) : saveState === 'error' ? (
          <p className="mt-error">Could not log the session. Try again.</p>
        ) : null}

        <div className="mt-run-actions">
          {saveState !== 'saved' && (
            <button className="mt-btn mt-btn-primary" onClick={logSession} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : 'Log Session'}
            </button>
          )}
          <button className="mt-btn" onClick={startNewSession}>New Session</button>
          <button className="mt-btn" onClick={finish}>Done</button>
        </div>
      </div>
    );
  }

  // ── Setup ──
  return (
    <div className="mt-container">
      <div className="mt-header">
        <h2 className="mt-title">Meditation Timer</h2>
        <button className="mt-btn mt-btn-sm" onClick={onClose}>← Workouts</button>
      </div>

      {/* Loading a preset always overwrites the list (Phase 1 Bug 7), including
          re-picking the one already loaded. */}
      <PresetList
        presets={presets}
        activePreset={activePreset}
        onLoad={applyPreset}
        onEdit={handleEditPreset}
        onRename={handleRenamePreset}
        onDelete={handleDeletePreset}
      />

      <SortableList
        className="mt-segments"
        items={segments}
        getKey={seg => seg._key}
        onMove={moveSegment}
        mode={prefs.reorder_mode}
        handleLabel={seg => `Reorder ${seg.name}`}
        renderItem={(seg, i, { handle }) => (
          <SegmentRow
            segment={seg}
            index={i}
            total={segments.length}
            onChange={next => updateSegment(i, next)}
            onMove={moveSegment}
            onRemove={removeSegment}
            handle={handle}
          />
        )}
      />

      <div className="mt-add-row">
        <button className="mt-btn mt-btn-sm" onClick={() => addSegment()}>+ Segment</button>
        {OPTIONAL_SEGMENTS.map(opt => (
          <button key={opt.name} className="mt-btn mt-btn-sm" onClick={() => addSegment({ ...opt })}>
            + {opt.name}
          </button>
        ))}
      </div>

      <div className="mt-total">Total {mmss(totalSeconds)}</div>

      <div className="mt-save-preset">
        <input
          type="text"
          placeholder="Save as preset (e.g. Morning TM)"
          value={newPresetName}
          onChange={e => setNewPresetName(e.target.value)}
        />
        <button className="mt-btn mt-btn-sm" onClick={handleSavePreset} disabled={!newPresetName.trim()}>
          Save
        </button>
      </div>

      <SoundSettings settings={sound} onChange={updateSound} />

      <button className="mt-btn mt-btn-primary mt-start" onClick={startSession} disabled={segments.length === 0}>
        Begin
      </button>
    </div>
  );
}
