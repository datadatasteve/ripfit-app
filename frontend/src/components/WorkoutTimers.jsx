import { useState, useEffect, useRef } from 'react';
import { playBeep, isTimerAudioEnabled, setTimerAudioEnabled } from './audioCues';
import './WorkoutTimers.css';

const DEFAULT_COOLDOWN = 60;

/**
 * Cooldown for an exercise before any user override: the routine's
 * cooldown_seconds, then a per-exercise rest_timer_seconds, then 60s.
 * Shared with ActiveWorkout so the button label and the rest timer agree.
 */
export function baseCooldownFor(exercise) {
  return exercise?.template?.cooldown_seconds
    || exercise?.cooldown_seconds
    || exercise?.rest_timer_seconds
    || DEFAULT_COOLDOWN;
}

function mmss(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Integer input that lets the user clear and retype freely. Nothing is
 * enforced while typing; on blur an empty, non-integer or below-minimum value
 * snaps to `min`. (A `min` attribute plus clamping in onChange made clearing
 * the field impossible, so typing "20" produced "120".)
 */
function IntField({ label, value, min, onCommit }) {
  const [draft, setDraft] = useState(null);

  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    onCommit(draft.trim() !== '' && Number.isInteger(n) && n >= min ? n : min);
    setDraft(null);
  };

  return (
    <label>{label}
      <input
        type="number"
        inputMode="numeric"
        value={draft ?? value}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </label>
  );
}

/** Persistent on/off switch for transition beeps, shown in every timer panel. */
function SoundToggle() {
  const [on, setOn] = useState(isTimerAudioEnabled);
  const toggle = () => {
    setTimerAudioEnabled(!on);
    setOn(!on);
  };
  return (
    <button
      type="button"
      className={`wt-sound-btn ${on ? 'on' : 'off'}`}
      onClick={toggle}
      aria-pressed={on}
      title="Beep at each timer transition"
    >
      {on ? '🔊 Sound: On' : '🔇 Sound: Off'}
    </button>
  );
}

export const TIMER_MODES = [
  { key: 'interval', label: 'Interval Timer', info: 'Work for a set duration, rest, repeat for a set number of rounds.' },
  { key: 'emom', label: 'EMOM', info: 'Complete a target number of reps every minute, on the minute.' },
  { key: 'amrap', label: 'AMRAP', info: 'Complete as many rounds as possible within a time cap.' },
  { key: 'tabata', label: 'Tabata', info: '8 rounds of 20 seconds work, 10 seconds rest.' },
];
const modeDef = key => TIMER_MODES.find(m => m.key === key);

/** ⓘ toggle: shows a one-line description inline beneath it (not a modal). */
function InfoToggle({ text, label }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="wt-info-btn" onClick={() => setOpen(o => !o)}
        aria-expanded={open} aria-label={`About ${label}`} title={`About ${label}`}>ⓘ</button>
      {open && <p className="wt-info-text">{text}</p>}
    </>
  );
}

/** Panel title row: name, ⓘ (when the mode has a description), sound toggle. */
function PanelHead({ title, info }) {
  return (
    <div className="wt-panel-head">
      <div className="wt-panel-title-wrap">
        <h4 className="wt-panel-title">{title}</h4>
        {info && <InfoToggle text={info} label={title} />}
      </div>
      <SoundToggle />
    </div>
  );
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
 * Time comes from a wall-clock deadline, not accumulated ticks, so a
 * backgrounded tab resumes on the right second. Phase boundaries chain from
 * the previous deadline. Side effects (beep, onPhaseEnd) run in the interval
 * callback — never inside a state updater, which React may call twice.
 *
 * `phases` must be a stable reference (state), or null before setup.
 */
function useCountdown(phases, { onPhaseEnd, onComplete }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const deadlineRef = useRef(null);
  const idxRef = useRef(0);
  const autoStartRef = useRef(false);
  const cbRef = useRef({ onPhaseEnd, onComplete });
  cbRef.current = { onPhaseEnd, onComplete };

  // A new phase list starts from its first phase — and runs straight away
  // when armed by `startWith` (the old code kept remaining at 0 here, so the
  // first phase was skipped the moment it started).
  useEffect(() => {
    const first = phases?.[0]?.seconds ?? 0;
    idxRef.current = 0;
    setPhaseIdx(0);
    setRemaining(first);
    setFinished(false);
    if (autoStartRef.current && phases?.length) {
      autoStartRef.current = false;
      deadlineRef.current = Date.now() + first * 1000;
      setRunning(true);
    } else {
      deadlineRef.current = null;
      setRunning(false);
    }
  }, [phases]);

  useEffect(() => {
    if (!running || finished || !phases?.length) return undefined;

    const id = setInterval(() => {
      if (deadlineRef.current === null) return;
      const left = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }

      // Phase boundary reached.
      playBeep({ frequency: 880 });   // no-op when timer audio is off
      if (navigator.vibrate) navigator.vibrate(150);

      const endedIdx = idxRef.current;
      cbRef.current.onPhaseEnd?.(phases[endedIdx], endedIdx);

      const nextIdx = endedIdx + 1;
      if (nextIdx >= phases.length) {
        deadlineRef.current = null;
        setRunning(false);
        setFinished(true);
        setRemaining(0);
        cbRef.current.onComplete?.();
        return;
      }
      idxRef.current = nextIdx;
      deadlineRef.current += phases[nextIdx].seconds * 1000;
      setPhaseIdx(nextIdx);
      setRemaining(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    }, 250);

    return () => clearInterval(id);
  }, [running, finished, phases]);

  const start = () => {
    if (finished || !phases?.length) return;
    deadlineRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  };

  const pause = () => {
    if (deadlineRef.current !== null) {
      setRemaining(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    }
    deadlineRef.current = null;
    setRunning(false);
  };

  const reset = () => {
    deadlineRef.current = null;
    idxRef.current = 0;
    setRunning(false);
    setFinished(false);
    setPhaseIdx(0);
    setRemaining(phases?.[0]?.seconds ?? 0);
  };

  /** Stop here and treat the timer as complete (AMRAP / block "Finish"). */
  const finishNow = () => {
    if (deadlineRef.current !== null) {
      setRemaining(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    }
    deadlineRef.current = null;
    setRunning(false);
    setFinished(true);
  };

  /** Arms an immediate start for the next phase list the caller sets. */
  const armStart = () => { autoStartRef.current = true; };

  return { phaseIdx, remaining, running, finished, start, pause, reset, finishNow, armStart };
}

/**
 * Setup + live view for one timer mode, rendered inline in the exercise card.
 *
 * Exercise mode: EMOM confirmations and Tabata intervals are written as
 * workout_sets through onLogSet as they happen; AMRAP logs its result at the
 * end. Block mode (no exercise yet): work is collected and handed to
 * onBlockComplete, which runs the "attach an exercise?" step.
 */
function TimerRunner({ mode, exerciseName, blockMode, setsBefore = 0, onClose, onLogSet, onAppendNote, onBlockComplete }) {
  const [cfg, setCfg] = useState({ work: 30, rest: 30, rounds: 8, reps: 10, minutes: 10, movement: '' });
  const [phases, setPhases] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [emomPending, setEmomPending] = useState([]);   // minutes awaiting yes/no
  const [emomDone, setEmomDone] = useState([]);         // confirmed minutes
  const [amrapRounds, setAmrapRounds] = useState(0);
  const [amrapFinalReps, setAmrapFinalReps] = useState('');
  const [amrapLogged, setAmrapLogged] = useState(false);
  const [tabataReps, setTabataReps] = useState({});     // round → reps typed
  const [tabataLog, setTabataLog] = useState([]);       // [{ round, reps }] completed
  const [intervalRounds, setIntervalRounds] = useState(0);
  const [logError, setLogError] = useState('');
  const tabataRepsRef = useRef(tabataReps);
  tabataRepsRef.current = tabataReps;
  // set_number = minute / interval number, offset by sets this exercise already
  // had when the timer started so the two never collide.
  const setBaseRef = useRef(setsBefore);

  const def = modeDef(mode);

  const record = async ({ ordinal, reps, setType }) => {
    if (blockMode) return;   // block work is written only once an exercise is attached
    try {
      await onLogSet({ set_number: setBaseRef.current + ordinal, reps, setType });
      setLogError('');
    } catch {
      setLogError('Could not save a set — check your connection.');
    }
  };

  const timer = useCountdown(phases, {
    onPhaseEnd: (phase) => {
      if (!phase) return;
      if (mode === 'emom') {
        setEmomPending(p => [...p, phase.round]);
      } else if (mode === 'tabata' && phase.kind === 'rest') {
        // An interval is complete once its rest ends, which leaves the 10 s
        // rest to type the rep count. 0 when nothing was entered.
        const reps = parseInt(tabataRepsRef.current[phase.round], 10) || 0;
        setTabataLog(l => [...l, { round: phase.round, reps }]);
        record({ ordinal: phase.round, reps, setType: 'tabata' });
      } else if (mode === 'interval' && phase.kind === 'work') {
        setIntervalRounds(n => n + 1);
      }
    },
  });

  const current = phases?.[timer.phaseIdx];
  const totalRounds = mode === 'tabata' ? 8 : mode === 'interval' ? cfg.rounds : mode === 'emom' ? cfg.minutes : 1;
  const amrapElapsed = mode === 'amrap' && phases ? cfg.minutes * 60 - timer.remaining : 0;

  const startTimer = () => {
    setBaseRef.current = setsBefore;
    timer.armStart();
    setPhases(buildPhases(mode, cfg));   // new list → engine resets and starts
    setHasStarted(true);
  };

  const resetTimer = () => {
    timer.reset();
    setHasStarted(false);
    setEmomPending([]);
    setEmomDone([]);
    setAmrapRounds(0);
    setAmrapFinalReps('');
    setAmrapLogged(false);
    setTabataReps({});
    setTabataLog([]);
    setIntervalRounds(0);
  };

  const closeTimer = () => {
    setHasStarted(false);
    onClose();
  };

  const confirmEmom = (minute, yes) => {
    setEmomPending(p => p.filter(m => m !== minute));
    if (!yes) return;
    setEmomDone(d => [...d, minute]);
    record({ ordinal: minute, reps: cfg.reps, setType: 'emom' });
  };

  const logAmrap = async () => {
    const partial = parseInt(amrapFinalReps, 10) || 0;
    const detail = `AMRAP ${mmss(amrapElapsed)}${cfg.movement ? ` (${cfg.movement})` : ''}: ${amrapRounds} round${amrapRounds === 1 ? '' : 's'} + ${partial} rep${partial === 1 ? '' : 's'}`;
    try {
      await onLogSet({ set_number: setBaseRef.current + 1, reps: amrapRounds, setType: 'amrap' });
      await onAppendNote?.(detail);
      setAmrapLogged(true);
      setLogError('');
    } catch {
      setLogError('Could not save the AMRAP result — try again.');
    }
  };

  /** Everything this block produced, for the attach step. */
  const blockSummary = () => {
    const sets = [];
    let detail = '';
    if (mode === 'emom') {
      emomDone.forEach(m => sets.push({ ordinal: m, reps: cfg.reps, setType: 'emom' }));
      detail = `${emomDone.length} of ${cfg.minutes} minutes confirmed at ${cfg.reps} reps`;
    } else if (mode === 'tabata') {
      tabataLog.forEach(t => sets.push({ ordinal: t.round, reps: t.reps, setType: 'tabata' }));
      const total = tabataLog.reduce((a, t) => a + t.reps, 0);
      detail = `${tabataLog.length} intervals${total ? `, ${total} reps` : ''}`;
    } else if (mode === 'interval') {
      for (let r = 1; r <= intervalRounds; r++) sets.push({ ordinal: r, reps: 0, setType: 'interval' });
      detail = `${intervalRounds} of ${cfg.rounds} rounds (${cfg.work}s work / ${cfg.rest}s rest)`;
    } else if (mode === 'amrap') {
      const partial = parseInt(amrapFinalReps, 10) || 0;
      sets.push({ ordinal: 1, reps: amrapRounds, setType: 'amrap' });
      detail = `${amrapRounds} rounds + ${partial} reps${cfg.movement ? ` (${cfg.movement})` : ''}`;
    }
    const elapsed = mode === 'amrap'
      ? amrapElapsed
      : (phases || []).slice(0, timer.finished ? phases.length : timer.phaseIdx).reduce((a, p) => a + p.seconds, 0);
    return { mode, label: def.label, sets, detail, elapsedSeconds: elapsed };
  };

  // ── Setup screen ──
  if (!phases) {
    return (
      <div className="wt-panel">
        <PanelHead title={def.label} info={def.info} />
        {exerciseName && <p className="wt-panel-sub">{exerciseName}</p>}

        {mode === 'interval' && (
          <div className="wt-fields">
            <IntField label="Work (sec)" value={cfg.work} min={1}
              onCommit={v => setCfg(c => ({ ...c, work: v }))} />
            <IntField label="Rest (sec)" value={cfg.rest} min={0}
              onCommit={v => setCfg(c => ({ ...c, rest: v }))} />
            <IntField label="Rounds" value={cfg.rounds} min={1}
              onCommit={v => setCfg(c => ({ ...c, rounds: v }))} />
          </div>
        )}

        {mode === 'emom' && (
          <div className="wt-fields">
            <IntField label="Reps per minute" value={cfg.reps} min={1}
              onCommit={v => setCfg(c => ({ ...c, reps: v }))} />
            <IntField label="Total minutes" value={cfg.minutes} min={1}
              onCommit={v => setCfg(c => ({ ...c, minutes: v }))} />
          </div>
        )}

        {mode === 'amrap' && (
          <div className="wt-fields">
            <IntField label="Time cap (min)" value={cfg.minutes} min={1}
              onCommit={v => setCfg(c => ({ ...c, minutes: v }))} />
            <label className="wt-field-wide">Movements
              <input type="text" placeholder="e.g. 5 pull-ups, 10 push-ups, 15 squats"
                value={cfg.movement} onChange={e => setCfg({ ...cfg, movement: e.target.value })} />
            </label>
          </div>
        )}

        {mode === 'tabata' && (
          <p className="wt-fixed-note">Fixed protocol: 20s work / 10s rest × 8 rounds (4:00 total).</p>
        )}

        {!blockMode && (mode === 'emom' || mode === 'tabata') && (
          <p className="wt-fixed-note">
            {mode === 'emom' ? 'Each minute you confirm' : 'Each completed interval'} is logged as a set on this exercise.
          </p>
        )}

        <div className="wt-panel-actions">
          <button className="wt-btn wt-btn-primary" onClick={startTimer}>Start</button>
          <button className="wt-btn" onClick={closeTimer}>Cancel</button>
        </div>
      </div>
    );
  }

  const emomPrompt = emomPending[0];
  const tabataRound = current?.round;
  const tabataTotal = tabataLog.reduce((a, t) => a + t.reps, 0);
  const showBlockAttach = blockMode && timer.finished && emomPending.length === 0;

  // ── Running screen ──
  return (
    <div className="wt-panel">
      <PanelHead title={def.label} info={def.info} />
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
          {!timer.finished && (
            <div className="wt-amrap-buttons">
              <button className="wt-btn" onClick={() => setAmrapRounds(r => Math.max(0, r - 1))}>−</button>
              <button className="wt-btn wt-btn-primary" onClick={() => setAmrapRounds(r => r + 1)}>+ Round</button>
            </div>
          )}
          {timer.finished && (
            <div className="wt-amrap-final">
              <label>Final partial reps
                <input type="number" inputMode="numeric" min="0" value={amrapFinalReps}
                  disabled={amrapLogged}
                  onChange={e => setAmrapFinalReps(e.target.value)} />
              </label>
              {!blockMode && (
                amrapLogged
                  ? <p className="wt-logged">✓ Logged: {amrapRounds} rounds + {parseInt(amrapFinalReps, 10) || 0} reps</p>
                  : <button className="wt-btn wt-btn-primary" onClick={logAmrap}>Log result</button>
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'emom' && emomPrompt !== undefined && (
        <div className="wt-prompt">
          <span>Completed {cfg.reps} reps in minute {emomPrompt}?</span>
          <div className="wt-prompt-actions">
            <button className="wt-btn wt-btn-primary" onClick={() => confirmEmom(emomPrompt, true)}>Yes</button>
            <button className="wt-btn" onClick={() => confirmEmom(emomPrompt, false)}>No</button>
          </div>
        </div>
      )}

      {mode === 'emom' && emomDone.length > 0 && (
        <p className="wt-panel-sub">
          Confirmed: {emomDone.length} / {cfg.minutes} minutes{!blockMode && ' — logged as sets'}
        </p>
      )}

      {mode === 'tabata' && !timer.finished && tabataRound && (
        <div className="wt-prompt">
          <label>Reps in interval {tabataRound}
            <input type="number" inputMode="numeric" min="0" value={tabataReps[tabataRound] ?? ''}
              onChange={e => setTabataReps({ ...tabataReps, [tabataRound]: e.target.value })} />
          </label>
        </div>
      )}

      {mode === 'tabata' && tabataLog.length > 0 && (
        <p className="wt-panel-sub wt-tabata-total">
          {tabataLog.length} interval{tabataLog.length === 1 ? '' : 's'} completed
          {tabataTotal > 0 && ` · ${tabataTotal} reps`}
          {!blockMode && ' — logged as sets'}
        </p>
      )}

      {logError && <p className="wt-error">{logError}</p>}

      {showBlockAttach ? (
        <BlockAttach
          summary={blockSummary()}
          onAttach={async (exercise) => { await onBlockComplete({ ...blockSummary(), exercise }); onClose(); }}
          onSkip={async () => { await onBlockComplete({ ...blockSummary(), exercise: null }); onClose(); }}
        />
      ) : (
        <div className="wt-panel-actions">
          {!timer.finished && (
            timer.running
              ? <button className="wt-btn" onClick={timer.pause}>Pause</button>
              : <button className="wt-btn wt-btn-primary" onClick={hasStarted ? timer.start : startTimer}>
                  {hasStarted ? 'Resume' : 'Start'}
                </button>
          )}
          {!timer.finished && (mode === 'amrap' || blockMode) && (
            <button className="wt-btn" onClick={timer.finishNow} title="Stop now and record what you've done">
              Finish
            </button>
          )}
          <button className="wt-btn" onClick={resetTimer}>Reset</button>
          <button className="wt-btn" onClick={closeTimer}>Close</button>
        </div>
      )}
    </div>
  );
}

// ── Timer block: attach an exercise afterwards ─────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const authJson = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('ripfit_token')}`,
});

/**
 * "Attach an exercise to this block?" — search the database, type any name
 * (created as a user-generated exercise if it doesn't exist), or skip and keep
 * the block as a workout note.
 */
function BlockAttach({ summary, onAttach, onSkip }) {
  const [tab, setTab] = useState('search');   // 'search' | 'type'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setError('');
    try {
      const res = await fetch(`${API_BASE}/workouts/exercises/search?q=${encodeURIComponent(q)}&limit=20&offset=0`, {
        headers: authJson(),
      });
      const data = await res.json();
      setResults(data.exercises || []);
    } catch {
      setError('Search failed — try again.');
    }
  };

  const attach = async (exercise) => {
    setBusy(true);
    setError('');
    try {
      await onAttach(exercise);
    } catch (err) {
      setError(err.message || 'Could not attach the exercise.');
      setBusy(false);
    }
  };

  const attachTyped = async () => {
    const name = typed.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/workouts/exercises/find-or-create`, {
        method: 'POST',
        headers: authJson(),
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the exercise');
      await onAttach(data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="wt-attach">
      <p className="wt-attach-title">Attach an exercise to this block?</p>
      <p className="wt-panel-sub">{summary.label} · {mmss(summary.elapsedSeconds)} · {summary.detail}</p>

      <div className="wt-attach-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'active' : ''}
          onClick={() => setTab('search')}>Search</button>
        <button role="tab" aria-selected={tab === 'type'} className={tab === 'type' ? 'active' : ''}
          onClick={() => setTab('type')}>Type a name</button>
      </div>

      {tab === 'search' ? (
        <>
          <div className="wt-attach-row">
            <input type="text" placeholder="Search exercises…" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()} />
            <button className="wt-btn wt-btn-sm" onClick={search} disabled={!query.trim()}>Search</button>
          </div>
          {results && (
            <ul className="wt-attach-results">
              {results.length === 0 && <li className="wt-panel-sub">No matches — try “Type a name”.</li>}
              {results.map(ex => (
                <li key={ex.id}>
                  <button disabled={busy} onClick={() => attach(ex)}>
                    <strong>{ex.name}</strong> <span>{ex.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="wt-attach-row">
          <input type="text" placeholder="e.g. Sandbag carry" value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && attachTyped()} />
          <button className="wt-btn wt-btn-sm wt-btn-primary" onClick={attachTyped} disabled={!typed.trim() || busy}>
            Attach
          </button>
        </div>
      )}

      {error && <p className="wt-error">{error}</p>}

      <button className="wt-btn wt-attach-skip" disabled={busy} onClick={async () => { setBusy(true); await onSkip(); }}>
        Skip — save as a workout note
      </button>
    </div>
  );
}

/**
 * Inline timer inside the exercise card (5d): a mode selector that collapses
 * into the chosen timer. `blockMode` runs it without an exercise (5e).
 */
export function InlineTimer({ exerciseName, blockMode = false, setsBefore = 0, onClose, onLogSet, onAppendNote, onBlockComplete }) {
  const [mode, setMode] = useState(null);

  if (!mode) {
    return (
      <div className="wt-inline">
        <div className="wt-panel">
          <PanelHead title={blockMode ? 'Timer Block' : 'Timer Modes'} />
          <p className="wt-panel-sub">
            {blockMode ? 'Run a timer first — attach an exercise when it ends.' : exerciseName}
          </p>
          <div className="wt-mode-grid">
            {TIMER_MODES.map(m => (
              <div key={m.key} className="wt-mode-cell">
                <div className="wt-mode-row">
                  <button className="wt-mode-btn" onClick={() => setMode(m.key)}>{m.label}</button>
                  <InfoToggle text={m.info} label={m.label} />
                </div>
              </div>
            ))}
          </div>
          <div className="wt-panel-actions">
            <button className="wt-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wt-inline">
      <TimerRunner
        mode={mode}
        exerciseName={exerciseName}
        blockMode={blockMode}
        setsBefore={setsBefore}
        onClose={onClose}
        onLogSet={onLogSet}
        onAppendNote={onAppendNote}
        onBlockComplete={onBlockComplete}
      />
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
 * The cooldown override is owned by the parent (WorkoutInProgress) so the rest
 * timer it starts after each set uses the same value. It lasts until the
 * exercise changes and is never written back to routine_exercises.
 */
export default function WorkoutTimerBar({ exercise, cooldownOverride, onCooldownOverrideChange, timerOpen, onToggleTimer }) {
  const [showVideo, setShowVideo] = useState(false);
  const [editingCooldown, setEditingCooldown] = useState(false);

  useEffect(() => { setShowVideo(false); }, [exercise?.id]);

  const effectiveCooldown = cooldownOverride ?? baseCooldownFor(exercise);
  const hasVideo = !!(exercise?.video_url_male || exercise?.video_url_female);

  if (!exercise?.id) return null;

  return (
    <div className="wt-bar-wrap">
      <div className="wt-bar">
        <button className={`wt-bar-btn ${timerOpen ? 'active' : ''}`} onClick={onToggleTimer} aria-expanded={!!timerOpen}>
          ⏱ Timers
        </button>

        {editingCooldown ? (
          <span className="wt-bar-cooldown-edit">
            <input
              type="number"
              min="0"
              autoFocus
              value={effectiveCooldown}
              onChange={e => onCooldownOverrideChange(Math.max(0, parseInt(e.target.value) || 0))}
              onBlur={() => setEditingCooldown(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingCooldown(false); }}
            />
            <span>s</span>
          </span>
        ) : (
          <button
            className={`wt-bar-btn ${cooldownOverride !== null ? 'overridden' : ''}`}
            onClick={() => setEditingCooldown(true)}
            title="Cooldown for this exercise — not saved to the routine"
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

    </div>
  );
}
