import { useState, useEffect, useRef } from 'react';
import { playSingingBowl } from './audioCues';
import './MeditationTimer.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const PRESETS_KEY = 'ripfit_meditation_presets';

const DEFAULT_SEGMENTS = [
  { name: 'Meditation', seconds: 21 * 60 },
  { name: 'Coming Out', seconds: 2 * 60 },
];

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
function SegmentRow({ segment, index, total, onChange, onMove, onRemove }) {
  const mins = Math.floor(segment.seconds / 60);
  const secs = segment.seconds % 60;

  const setDuration = (m, s) => {
    const next = Math.max(1, (parseInt(m) || 0) * 60 + (parseInt(s) || 0));
    onChange({ ...segment, seconds: next });
  };

  return (
    <div className="mt-seg-row">
      <input
        className="mt-seg-name"
        type="text"
        value={segment.name}
        onChange={e => onChange({ ...segment, name: e.target.value })}
        aria-label={`Segment ${index + 1} name`}
      />
      <div className="mt-seg-duration">
        <input
          type="number" min="0" value={mins}
          onChange={e => setDuration(e.target.value, secs)}
          aria-label="Minutes"
        />
        <span>:</span>
        <input
          type="number" min="0" max="59" value={String(secs).padStart(2, '0')}
          onChange={e => setDuration(mins, e.target.value)}
          aria-label="Seconds"
        />
      </div>
      <div className="mt-seg-actions">
        <button onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label="Move up">↑</button>
        <button onClick={() => onMove(index, index + 1)} disabled={index === total - 1} aria-label="Move down">↓</button>
        <button onClick={() => onRemove(index)} className="mt-seg-remove" aria-label="Remove segment">×</button>
      </div>
    </div>
  );
}

/**
 * Standalone multi-segment meditation timer.
 *
 * Segments run back to back; each one ends with a singing-bowl tone. The
 * session is logged as a workout with workout_type 'meditation', which keeps
 * it out of the strength and cardio stats queries.
 */
export default function MeditationTimer({ onClose }) {
  const [segments, setSegments] = useState(DEFAULT_SEGMENTS);
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [activePreset, setActivePreset] = useState('');
  const [newPresetName, setNewPresetName] = useState('');

  const [phase, setPhase] = useState('setup');      // 'setup' | 'running' | 'done'
  const [segIdx, setSegIdx] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [paused, setPaused] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved' | 'error'

  const deadlineRef = useRef(null);
  const wakeLockRef = useRef(null);

  const totalSeconds = segments.reduce((sum, s) => sum + s.seconds, 0);

  // ── Wake lock: best-effort only, silently unavailable on most browsers ──
  useEffect(() => {
    if (phase !== 'running') return undefined;

    (async () => {
      try {
        if (navigator.wakeLock?.request) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch {
        /* not supported or denied — session still runs */
      }
    })();

    return () => {
      try { wakeLockRef.current?.release?.(); } catch { /* ignore */ }
      wakeLockRef.current = null;
    };
  }, [phase]);

  // ── Countdown driven by a wall-clock deadline ──
  useEffect(() => {
    if (phase !== 'running' || paused) return undefined;

    if (deadlineRef.current === null) {
      deadlineRef.current = Date.now() + remaining * 1000;
    }

    const id = setInterval(() => {
      const left = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }

      playSingingBowl(segIdx === segments.length - 1 ? { fundamental: 324, duration: 9 } : {});

      if (segIdx < segments.length - 1) {
        const next = segIdx + 1;
        deadlineRef.current = Date.now() + segments[next].seconds * 1000;
        setSegIdx(next);
        setRemaining(segments[next].seconds);
      } else {
        deadlineRef.current = null;
        setRemaining(0);
        setPhase('done');
      }
    }, 250);

    return () => clearInterval(id);
  }, [phase, paused, segIdx, segments]);

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
  const addSegment = (seg) => setSegments(segs => [...segs, seg || { name: 'New segment', seconds: 5 * 60 }]);

  const applyPreset = (name) => {
    setActivePreset(name);
    if (!name) { setSegments(DEFAULT_SEGMENTS); setPresetName(''); return; }
    const preset = presets.find(p => p.name === name);
    if (preset) { setSegments(preset.segments); setPresetName(preset.name); }
  };

  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const next = [...presets.filter(p => p.name !== name), { name, segments }];
    setPresets(next);
    savePresets(next);
    setActivePreset(name);
    setPresetName(name);
    setNewPresetName('');
  };

  const handleDeletePreset = () => {
    if (!activePreset) return;
    const next = presets.filter(p => p.name !== activePreset);
    setPresets(next);
    savePresets(next);
    setActivePreset('');
    setPresetName('');
  };

  const startSession = () => {
    if (segments.length === 0) return;
    // A user gesture is required before WebAudio will play; priming here means
    // the first segment-end bowl is audible.
    playSingingBowl({ volume: 0.001, duration: 0.3 });
    deadlineRef.current = null;
    setSegIdx(0);
    setRemaining(segments[0].seconds);
    setStartedAt(Date.now());
    setPaused(false);
    setPhase('running');
  };

  const togglePause = () => {
    if (paused) {
      deadlineRef.current = Date.now() + remaining * 1000;
      setPaused(false);
    } else {
      setRemaining(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
      deadlineRef.current = null;
      setPaused(true);
    }
  };

  const skipSegment = () => {
    playSingingBowl();
    if (segIdx < segments.length - 1) {
      const next = segIdx + 1;
      deadlineRef.current = paused ? null : Date.now() + segments[next].seconds * 1000;
      setSegIdx(next);
      setRemaining(segments[next].seconds);
    } else {
      deadlineRef.current = null;
      setRemaining(0);
      setPhase('done');
    }
  };

  const endEarly = () => {
    deadlineRef.current = null;
    setPhase('done');
  };

  /** Log the finished session as a meditation workout. */
  const logSession = async () => {
    setSaveState('saving');
    const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : totalSeconds;
    const breakdown = segments.map(s => `${s.name} — ${mmss(s.seconds)}`).join('\n');
    const notes = [
      presetName ? `Preset: ${presetName}` : null,
      `Total: ${mmss(elapsed)}`,
      'Segments:',
      breakdown,
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
          workout_title: presetName || 'Meditation',
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

      await fetch(`${API_BASE}/workouts/${id}/finish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      });

      setSaveState('saved');
    } catch (err) {
      console.error('Failed to log meditation session:', err);
      setSaveState('error');
    }
  };

  // ── Running ──
  if (phase === 'running') {
    const current = segments[segIdx];
    const pct = current.seconds > 0 ? ((current.seconds - remaining) / current.seconds) * 100 : 0;

    return (
      <div className="mt-container mt-running">
        <div className="mt-run-segment">{current.name}</div>
        <div className="mt-run-clock">{mmss(remaining)}</div>
        <div className="mt-run-progress">
          <div className="mt-run-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-run-meta">
          Segment {segIdx + 1} of {segments.length}
          {paused && <span className="mt-run-paused"> · paused</span>}
        </div>

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
  if (phase === 'done') {
    const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    return (
      <div className="mt-container">
        <h2 className="mt-title">Session complete</h2>
        <p className="mt-done-total">{mmss(elapsed)}</p>
        {presetName && <p className="mt-subtle">Preset: {presetName}</p>}

        <div className="mt-done-breakdown">
          {segments.map((s, i) => (
            <div key={i} className="mt-done-row"><span>{s.name}</span><span>{mmss(s.seconds)}</span></div>
          ))}
        </div>

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
          <button className="mt-btn" onClick={() => { setPhase('setup'); setSaveState(''); }}>New Session</button>
          <button className="mt-btn" onClick={onClose}>Done</button>
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

      <div className="mt-preset-row">
        <label className="mt-preset-label">Preset</label>
        <select value={activePreset} onChange={e => applyPreset(e.target.value)}>
          <option value="">Default (Meditation + Coming Out)</option>
          {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        {activePreset && (
          <button className="mt-btn mt-btn-sm mt-preset-delete" onClick={handleDeletePreset}>Delete</button>
        )}
      </div>

      <div className="mt-segments">
        {segments.map((seg, i) => (
          <SegmentRow
            key={i}
            segment={seg}
            index={i}
            total={segments.length}
            onChange={next => updateSegment(i, next)}
            onMove={moveSegment}
            onRemove={removeSegment}
          />
        ))}
      </div>

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

      <button className="mt-btn mt-btn-primary mt-start" onClick={startSession} disabled={segments.length === 0}>
        Begin
      </button>
    </div>
  );
}
