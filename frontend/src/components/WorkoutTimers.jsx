import { useState, useEffect, useRef } from 'react';
import { playBeep } from './audioCues';
import './WorkoutTimers.css';

const DEFAULT_COOLDOWN = 60;

function mmss(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Expands a mode config into an ordered list of phases.
 * Each phase: { label, seconds, round, kind } where kind is 'work' | 'rest'.
 */
function buildPhases(mode, cfg) {
  const phases = [];
  if (mode === 'interval') {
    for (let r = 1; r <= cfg.rounds; r++) {
      phases.push({ label: 'Work', seconds: cfg.work, round: r, kind: 'work' });
      if (cfg.rest > 0) phases.push({ label: 'Rest', seconds: cfg.rest, round: r, kind: 'rest' });
    }
  } else if (mode === 'tabata') {
    for (let r = 1; r <= 8; r++) {
      phases.push({ label: 'Work', seconds: 20, round: r, kind: 'work' });
      phases.push({ label: 'Rest', seconds: 10, round: r, kind: 'rest' });
    }
  } else if (mode === 'emom') {
    for (let r = 1; r <= cfg.minutes; r++) {
      phases.push({ label: `Minute ${r}`, seconds: 60, round: r, kind: 'work' });
    }
  } else if (mode === 'amrap') {
    phases.push({ label: 'AMRAP', seconds: cfg.minutes * 60, round: 1, kind: 'work' });
  }
  return phases;
}

/**
 * Countdown engine shared by every timer mode.
 *
 * Time is derived from a wall-clock deadline rather than accumulated ticks, so
 * a backgrounded tab resumes with the correct remaining time.
 */
function useCountdown(phases, { onPhaseEnd, onComplete, soundOn }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [remaining, setRemaining] = useState(phases[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const deadlineRef = useRef(null);

  // Callbacks are read through a ref so the interval never needs re-creating.
  const cbRef = useRef({ onPhaseEnd, onComplete, soundOn });
  cbRef.current = { onPhaseEnd, onComplete, soundOn };

  useEffect(() => {
    if (!running || finished) return undefined;

    if (deadlineRef.current === null) {
      deadlineRef.current = Date.now() + remaining * 1000;
    }

    const id = setInterval(() => {
      const left = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }

      // Phase boundary reached.
      if (cbRef.current.soundOn) playBeep({ frequency: 880 });
      if (navigator.vibrate) navigator.vibrate(150);

      setPhaseIdx(prevIdx => {
        const ended = phases[prevIdx];
        cbRef.current.onPhaseEnd?.(ended, prevIdx);

        const nextIdx = prevIdx + 1;
        if (nextIdx >= phases.length) {
          deadlineRef.current = null;
          setRunning(false);
          setFinished(true);
          setRemaining(0);
          cbRef.current.onComplete?.();
          return prevIdx;
        }

        deadlineRef.current = Date.now() + phases[nextIdx].seconds * 1000;
        setRemaining(phases[nextIdx].seconds);
        return nextIdx;
      });
    }, 250);

    return () => clearInterval(id);
  }, [running, finished, phases]);

  const start = () => {
    if (finished) return;
    deadlineRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  };

  const pause = () => {
    setRemaining(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    deadlineRef.current = null;
    setRunning(false);
  };

  const reset = () => {
    deadlineRef.current = null;
    setRunning(false);
    setFinished(false);
    setPhaseIdx(0);
    setRemaining(phases[0]?.seconds ?? 0);
  };

  return { phaseIdx, remaining, running, finished, start, pause, reset };
}

/** Setup form + live run view for one timer mode. */
function TimerRunner({ mode, exerciseName, onClose, onLogReps }) {
  const [cfg, setCfg] = useState({ work: 30, rest: 30, rounds: 8, reps: 10, minutes: 10, movement: '' });
  const [phases, setPhases] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [emomPrompt, setEmomPrompt] = useState(null);   // round awaiting confirmation
  const [emomDone, setEmomDone] = useState([]);         // confirmed round numbers
  const [amrapRounds, setAmrapRounds] = useState(0);
  const [amrapFinalReps, setAmrapFinalReps] = useState('');
  const [tabataReps, setTabataReps] = useState({});     // round → reps

  const timer = useCountdown(phases || [], {
    soundOn,
    onPhaseEnd: (phase) => {
      if (mode === 'emom' && phase) setEmomPrompt(phase.round);
    },
  });

  const current = phases?.[timer.phaseIdx];
  const totalRounds = mode === 'tabata' ? 8 : mode === 'interval' ? cfg.rounds : mode === 'emom' ? cfg.minutes : 1;

  // ── Setup screen ──
  if (!phases) {
    return (
      <div className="wt-panel">
        <h4 className="wt-panel-title">{TIMER_MODES.find(m => m.key === mode).label}</h4>
        {exerciseName && <p className="wt-panel-sub">{exerciseName}</p>}

        {mode === 'interval' && (
          <div className="wt-fields">
            <label>Work (sec)
              <input type="number" min="1" value={cfg.work}
                onChange={e => setCfg({ ...cfg, work: Math.max(1, parseInt(e.target.value) || 0) })} />
            </label>
            <label>Rest (sec)
              <input type="number" min="0" value={cfg.rest}
                onChange={e => setCfg({ ...cfg, rest: Math.max(0, parseInt(e.target.value) || 0) })} />
            </label>
            <label>Rounds
              <input type="number" min="1" value={cfg.rounds}
                onChange={e => setCfg({ ...cfg, rounds: Math.max(1, parseInt(e.target.value) || 0) })} />
            </label>
          </div>
        )}

        {mode === 'emom' && (
          <div className="wt-fields">
            <label>Reps per minute
              <input type="number" min="1" value={cfg.reps}
                onChange={e => setCfg({ ...cfg, reps: Math.max(1, parseInt(e.target.value) || 0) })} />
            </label>
            <label>Total minutes
              <input type="number" min="1" value={cfg.minutes}
                onChange={e => setCfg({ ...cfg, minutes: Math.max(1, parseInt(e.target.value) || 0) })} />
            </label>
          </div>
        )}

        {mode === 'amrap' && (
          <div className="wt-fields">
            <label>Time cap (min)
              <input type="number" min="1" value={cfg.minutes}
                onChange={e => setCfg({ ...cfg, minutes: Math.max(1, parseInt(e.target.value) || 0) })} />
            </label>
            <label className="wt-field-wide">Movements
              <input type="text" placeholder="e.g. 5 pull-ups, 10 push-ups, 15 squats"
                value={cfg.movement} onChange={e => setCfg({ ...cfg, movement: e.target.value })} />
            </label>
          </div>
        )}

        {mode === 'tabata' && (
          <p className="wt-fixed-note">Fixed protocol: 20s work / 10s rest × 8 rounds (4:00 total).</p>
        )}

        <label className="wt-sound-toggle">
          <input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} />
          Audio alert at each transition
        </label>

        <div className="wt-panel-actions">
          <button className="wt-btn wt-btn-primary" onClick={() => setPhases(buildPhases(mode, cfg))}>
            Start
          </button>
          <button className="wt-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Running screen ──
  return (
    <div className="wt-panel">
      <h4 className="wt-panel-title">{TIMER_MODES.find(m => m.key === mode).label}</h4>
      {mode === 'amrap' && cfg.movement && <p className="wt-panel-sub">{cfg.movement}</p>}

      <div className={`wt-clock ${current?.kind === 'rest' ? 'rest' : 'work'} ${timer.finished ? 'done' : ''}`}>
        <div className="wt-clock-phase">{timer.finished ? 'Complete' : current?.label}</div>
        <div className="wt-clock-time">{mmss(timer.remaining)}</div>
        {mode !== 'amrap' && (
          <div className="wt-clock-round">Round {current?.round ?? totalRounds} of {totalRounds}</div>
        )}
        {mode === 'emom' && <div className="wt-clock-round">{cfg.reps} reps this minute</div>}
      </div>

      {mode === 'amrap' && (
        <div className="wt-amrap">
          <div className="wt-amrap-count">Rounds: <strong>{amrapRounds}</strong></div>
          <div className="wt-amrap-buttons">
            <button className="wt-btn" onClick={() => setAmrapRounds(r => Math.max(0, r - 1))}>−</button>
            <button className="wt-btn wt-btn-primary" onClick={() => setAmrapRounds(r => r + 1)}>+ Round</button>
          </div>
          {timer.finished && (
            <div className="wt-amrap-final">
              <label>Final partial reps
                <input type="number" min="0" value={amrapFinalReps}
                  onChange={e => setAmrapFinalReps(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      )}

      {mode === 'emom' && emomPrompt !== null && (
        <div className="wt-prompt">
          <span>Completed {cfg.reps} reps in minute {emomPrompt}?</span>
          <div className="wt-prompt-actions">
            <button className="wt-btn wt-btn-primary" onClick={() => {
              setEmomDone(d => [...d, emomPrompt]);
              onLogReps?.(cfg.reps);
              setEmomPrompt(null);
            }}>Yes</button>
            <button className="wt-btn" onClick={() => setEmomPrompt(null)}>No</button>
          </div>
        </div>
      )}

      {mode === 'emom' && emomDone.length > 0 && (
        <p className="wt-panel-sub">Confirmed: {emomDone.length} / {cfg.minutes} minutes</p>
      )}

      {mode === 'tabata' && current?.kind === 'work' && !timer.finished && (
        <div className="wt-prompt">
          <label>Reps this interval
            <input type="number" min="0" value={tabataReps[current.round] ?? ''}
              onChange={e => setTabataReps({ ...tabataReps, [current.round]: e.target.value })} />
          </label>
        </div>
      )}

      <div className="wt-panel-actions">
        {!timer.finished && (
          timer.running
            ? <button className="wt-btn" onClick={timer.pause}>Pause</button>
            : <button className="wt-btn wt-btn-primary" onClick={timer.start}>
                {timer.remaining === phases[0]?.seconds && timer.phaseIdx === 0 ? 'Go' : 'Resume'}
              </button>
        )}
        <button className="wt-btn" onClick={timer.reset}>Reset</button>
        <button className="wt-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export const TIMER_MODES = [
  { key: 'interval', label: 'Interval Timer' },
  { key: 'emom', label: 'EMOM' },
  { key: 'amrap', label: 'AMRAP' },
  { key: 'tabata', label: 'Tabata' },
];

/** Modal that picks a mode then hands off to TimerRunner. */
function TimerModal({ exerciseName, onClose, onLogReps }) {
  const [mode, setMode] = useState(null);

  return (
    <div className="wt-overlay" onClick={onClose}>
      <div className="wt-modal" onClick={e => e.stopPropagation()}>
        {!mode ? (
          <div className="wt-panel">
            <h4 className="wt-panel-title">Timer Modes</h4>
            {exerciseName && <p className="wt-panel-sub">{exerciseName}</p>}
            <div className="wt-mode-grid">
              {TIMER_MODES.map(m => (
                <button key={m.key} className="wt-mode-btn" onClick={() => setMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="wt-panel-actions">
              <button className="wt-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <TimerRunner
            mode={mode}
            exerciseName={exerciseName}
            onLogReps={onLogReps}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

/** Inline demo video player — male/female toggle when both URLs exist. */
function VideoPanel({ exercise, onClose }) {
  const male = exercise.video_url_male;
  const female = exercise.video_url_female;
  const [which, setWhich] = useState(male ? 'male' : 'female');
  const src = which === 'male' ? male : female;

  return (
    <div className="wt-video">
      <div className="wt-video-bar">
        {male && female && (
          <div className="wt-video-toggle">
            <button className={which === 'male' ? 'active' : ''} onClick={() => setWhich('male')}>Male</button>
            <button className={which === 'female' ? 'active' : ''} onClick={() => setWhich('female')}>Female</button>
          </div>
        )}
        <button className="wt-btn wt-btn-sm" onClick={onClose}>Hide</button>
      </div>
      <video className="wt-video-player" src={src} controls playsInline preload="metadata" />
    </div>
  );
}

/**
 * Compact toolbar rendered inside the active workout: cooldown length, timer
 * modes, and the demo video toggle.
 *
 * The cooldown override is deliberately local state — per spec it applies to
 * the current set only and is never written back to routine_exercises.
 */
export default function WorkoutTimerBar({ exercise, onLogReps }) {
  const [showTimer, setShowTimer] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [editingCooldown, setEditingCooldown] = useState(false);

  const routineCooldown = exercise?.template?.cooldown_seconds ?? exercise?.cooldown_seconds ?? null;
  const baseCooldown = routineCooldown || DEFAULT_COOLDOWN;
  const [cooldownOverride, setCooldownOverride] = useState(null);

  // A new exercise clears any single-set override from the previous one.
  useEffect(() => { setCooldownOverride(null); setShowVideo(false); }, [exercise?.id]);

  const effectiveCooldown = cooldownOverride ?? baseCooldown;
  const hasVideo = !!(exercise?.video_url_male || exercise?.video_url_female);

  if (!exercise?.id) return null;

  return (
    <div className="wt-bar-wrap">
      <div className="wt-bar">
        <button className="wt-bar-btn" onClick={() => setShowTimer(true)}>⏱ Timers</button>

        {editingCooldown ? (
          <span className="wt-bar-cooldown-edit">
            <input
              type="number"
              min="0"
              autoFocus
              value={effectiveCooldown}
              onChange={e => setCooldownOverride(Math.max(0, parseInt(e.target.value) || 0))}
              onBlur={() => setEditingCooldown(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingCooldown(false); }}
            />
            <span>s</span>
          </span>
        ) : (
          <button
            className={`wt-bar-btn ${cooldownOverride !== null ? 'overridden' : ''}`}
            onClick={() => setEditingCooldown(true)}
            title="Cooldown for this set only — not saved to the routine"
          >
            Cooldown {effectiveCooldown}s
          </button>
        )}

        {hasVideo && (
          <button className="wt-bar-btn" onClick={() => setShowVideo(v => !v)}>
            {showVideo ? '▼ Video' : '▶ Video'}
          </button>
        )}
      </div>

      {showVideo && hasVideo && (
        <VideoPanel exercise={exercise} onClose={() => setShowVideo(false)} />
      )}

      {showTimer && (
        <TimerModal
          exerciseName={exercise.exercise_name}
          onLogReps={onLogReps}
          onClose={() => setShowTimer(false)}
        />
      )}
    </div>
  );
}
