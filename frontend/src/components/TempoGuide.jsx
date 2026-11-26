import { useState, useEffect, useRef, useCallback } from 'react';
import {
  primeAudio, scheduleCountdownBeeps, scheduleClickPattern, tempoClickBeats, tempoSetBeats,
  isTimerAudioEnabled, setTimerAudioEnabled, onTimerAudioChange, playTestSound, audioStatus,
} from './audioCues';
import { formatTempo } from './RoutineExerciseExtras';
import { useUserPrefs } from '../contexts/UserPrefsContext';

const VISUAL_KEY = 'ripfit_tempo_visual';
// Tempo clicks switched off for one workout (Phase 0B-1b): sessionStorage key
// per workout id, so it lasts through a reload but not into the next workout.
const TRACK_OFF_KEY = 'ripfit_tempo_track_off:';
const FADE_OUT_S = 0.5;
// Reps for a set when the exercise has no target reps (Phase 0B-2).
const DEFAULT_SET_REPS = 10;
const MAX_SET_REPS = 100;

function readFlag(key) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeFlag(key, value) {
  try { localStorage.setItem(key, String(!!value)); } catch { /* not persisted */ }
}

function readTrackOff(workoutKey) {
  if (workoutKey == null) return false;
  try { return sessionStorage.getItem(TRACK_OFF_KEY + workoutKey) === '1'; } catch { return false; }
}

const positiveInt = v => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The timer Sound switch (ripfit_timer_audio), kept in step across the screen. */
export function useTimerAudioEnabled() {
  const [on, setOn] = useState(isTimerAudioEnabled);
  useEffect(() => onTimerAudioChange(setOn), []);
  return on;
}

/**
 * Test sound (Phase 0B-2): plays a click, an accent click and the end-of-rep
 * beep, then says what would keep the workout sounds quiet. Used in the
 * exercise's Tempo Guide panel and in App Settings.
 */
export function TestSoundButton({ className = '' }) {
  const soundOn = useTimerAudioEnabled();
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const test = () => {
    const ok = playTestSound();
    setStatus({ ok, ...audioStatus() });
    // The context resumes asynchronously; read its state again once it has.
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus(s => s && { ...s, ...audioStatus() }), 400);
  };

  let line = null;
  if (status) {
    if (!status.supported || !status.ok) {
      line = 'This browser has no Web Audio, so the app cannot make sounds here.';
    } else if (status.state !== 'running') {
      line = `The browser kept the sound engine paused (${status.state}). Tap Test sound again; if it stays silent, check the site's sound permission in the browser settings.`;
    } else {
      line = 'Sound engine running. You should hear click, click, beep. If not, turn up the media volume (on iPhone, also the ring/silent switch).';
    }
  }

  return (
    <div className={`aw-test-sound ${className}`}>
      <button type="button" className="aw-test-sound-btn" onClick={test}>🔈 Test sound</button>
      {line && <p className="aw-tempo-hint" role="status">{line}</p>}
      {!soundOn && (
        <p className="aw-tempo-hint aw-sound-off">
          Workout sounds are off (the Timers&apos; Sound switch).{' '}
          <button type="button" className="aw-link-btn" onClick={() => setTimerAudioEnabled(true)}>Turn on</button>
        </p>
      )}
    </div>
  );
}

/**
 * Tempo guide for the current exercise (Feature 8c/8d; tempo track 0B-1b;
 * Start Set 0B-2).
 *
 * Returns pieces for the caller to place:
 *   tempoLine       "Tempo: 3-1-2", the Start Set button (and the "Reps for
 *                   this set" field when the exercise has no target reps),
 *                   and the Tempo Guide panel
 *   guideView       the live display: "Rep N of M", the phase, seconds left
 *   startTrack / stopTrack / trackAvailable / trackRunning  for the Timers
 *                   tie-in (an open-ended click track, as in 0B-1b)
 * `onGlow(bool)` drives the card / screen-edge glow.
 *
 * Start Set's reps: the reps typed in the set form (owner's choice, 0B-2),
 * else the top of the exercise's target range (`targetReps`), else the
 * "Reps for this set" field (10 unless edited; it never changes the target).
 *
 * Tempo is stored as three parts (routine_exercises.tempo_eccentric / _pause /
 * _concentric, migration 024). The schedules take any list of phases, so a
 * fourth part would only need passing in.
 */
export function useTempoGuide({ exerciseKey, workoutKey = null, eccentric, pause, concentric, typedReps = null, targetReps = null, onGlow }) {
  const { prefs } = useUserPrefs();
  const [storedVisual, setStoredVisual] = useState(() => readFlag(VISUAL_KEY));
  const [panelOpen, setPanelOpen] = useState(false);
  const [track, setTrack] = useState(null); // { rep, of, phase, count, leadIn, kind } while a set or track plays
  const [trackOff, setTrackOff] = useState(() => readTrackOff(workoutKey));
  const [repsDraft, setRepsDraft] = useState(null);   // the "Reps for this set" field, once edited
  const soundOn = useTimerAudioEnabled();

  useEffect(() => { setTrackOff(readTrackOff(workoutKey)); }, [workoutKey]);
  // Typed reps win, so typing reps in the set form resets the field to them.
  useEffect(() => { setRepsDraft(null); }, [typedReps, exerciseKey]);

  const visual = storedVisual ?? !!prefs.tempo_visual_enabled;
  const trackPref = prefs.tempo_click_track_enabled !== false;

  const toNum = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const e = toNum(eccentric), p = toNum(pause), c = toNum(concentric);
  const hasTempo = e !== null || p !== null || c !== null;
  const phases = [['Eccentric', e], ['Pause', p], ['Concentric', c]]
    .filter(([, sec]) => Number.isFinite(sec) && sec > 0)
    .map(([name, sec]) => ({ name, sec: Math.round(sec) }));
  const phasesKey = phases.map(x => x.sec).join('-');

  // Clicks play only with the Tempo click track setting on and not switched
  // off for this workout (and, inside audioCues, the timer Sound switch on).
  const clicksAllowed = trackPref && !trackOff;
  const trackAvailable = clicksAllowed && phases.length > 0;

  const typed = positiveInt(typedReps);
  const rangeTop = positiveInt(targetReps);
  const needsRepsField = rangeTop === null;
  const fieldReps = repsDraft !== null ? repsDraft : String(typed ?? DEFAULT_SET_REPS);
  const setReps = typed ?? rangeTop ?? Math.min(MAX_SET_REPS, positiveInt(fieldReps) ?? DEFAULT_SET_REPS);

  // Lead-in before rep 1 (Phase 0B-1): N beeps, then a higher "go" beep as
  // the first phase starts. 0 = no lead-in.
  const leadIn = Math.max(0, Math.min(5, Math.round(Number(prefs.tempo_countdown_beeps ?? 3) || 0)));

  const trackTimerRef = useRef(null);
  const trackCtrlRef = useRef(null);
  const glowRef = useRef(false);
  const onGlowRef = useRef(onGlow);
  onGlowRef.current = onGlow;

  const setGlow = useCallback((on) => {
    if (glowRef.current === on) return;
    glowRef.current = on;
    onGlowRef.current?.(on);
  }, []);

  const stopTrack = useCallback(() => {
    if (trackTimerRef.current) clearInterval(trackTimerRef.current);
    trackTimerRef.current = null;
    trackCtrlRef.current?.cancel();
    trackCtrlRef.current = null;
    setTrack(null);
  }, []);

  const stop = useCallback(() => {
    stopTrack();
    setGlow(false);
  }, [stopTrack, setGlow]);

  // A different exercise, a different tempo, or leaving the view ends any
  // set or track in progress.
  useEffect(() => stop, [exerciseKey, phasesKey, stop]);

  /**
   * Runs the live display (and glow) against `startAt` (performance.now ms of
   * rep 1's start) for `reps` reps of `cycleSeconds` each.
   */
  const runDisplay = (startAt, reps, cycleSeconds, kind) => {
    const step = () => {
      const t = (performance.now() - startAt) / 1000;
      if (t < 0) {
        setGlow(false);
        setTrack({ rep: 0, of: reps, phase: 'Get ready', count: Math.ceil(-t), leadIn: true, kind });
        return;
      }
      const repIdx = Math.floor(t / cycleSeconds);
      if (repIdx >= reps) {
        // Finished by itself: end the display but leave the audio alone, so
        // the last rep's beep (which starts right now) plays out in full.
        if (trackTimerRef.current) clearInterval(trackTimerRef.current);
        trackTimerRef.current = null;
        trackCtrlRef.current = null;
        setTrack(null);
        setGlow(false);
        return;
      }
      const inRep = t - repIdx * cycleSeconds;
      let acc = 0;
      let k = 0;
      for (let i = 0; i < phases.length; i++) {
        if (inRep < acc + phases[i].sec) { k = i; break; }
        acc += phases[i].sec;
      }
      const inPhase = inRep - acc;
      if (visual) setGlow(inPhase < phases[k].sec - FADE_OUT_S);
      setTrack({ rep: repIdx + 1, of: reps, phase: phases[k].name, count: Math.max(1, Math.ceil(phases[k].sec - inPhase)), leadIn: false, kind });
    };
    step();
    trackTimerRef.current = setInterval(step, 100);
  };

  /**
   * Start Set (Phase 0B-2): the lead-in, then every rep of the set back to
   * back, a click per second, an accent at each phase start, and a
   * half-second beep at the end of each rep; nothing after the last beep.
   * Call from the tap. Silent (display and glow only) when the clicks are
   * off in Settings or for this workout; audioCues applies the Sound switch.
   */
  const startSet = () => {
    if (phases.length === 0) return;
    stopTrack();
    primeAudio();
    const reps = setReps;
    const { beats, cycleSeconds } = tempoSetBeats(phases.map(x => x.sec), reps, { leadIn: leadIn > 0 });
    let ctrl;
    if (clicksAllowed) {
      const cancelLead = leadIn > 0 ? scheduleCountdownBeeps(leadIn) : () => {};
      const pattern = scheduleClickPattern({ beats, cycleSeconds: reps * cycleSeconds + 1, cycles: 1, startDelay: leadIn });
      ctrl = { startAt: pattern.startAt, cancel: () => { cancelLead(); pattern.cancel(); } };
    } else {
      ctrl = { startAt: performance.now() + leadIn * 1000, cancel: () => {} };
    }
    trackCtrlRef.current = ctrl;
    runDisplay(ctrl.startAt, reps, cycleSeconds, 'set');
  };

  /**
   * The open-ended tempo click track (0B-1b), kept for the Timers tie-in: a
   * click for every second of every phase, a "go" at the top of each rep,
   * rep after rep until Stop or `reps`. `withLeadIn` false is for the
   * Timers, where the timer's own start marks the beginning.
   */
  const startTrack = useCallback(({ withLeadIn = true } = {}) => {
    if (phases.length === 0) return;
    stopTrack();
    primeAudio();
    const lead = withLeadIn ? leadIn : 0;
    const reps = typed ?? rangeTop ?? Infinity;
    const cancelLead = lead > 0 ? scheduleCountdownBeeps(lead) : () => {};
    const { beats, cycleSeconds } = tempoClickBeats(phases.map(x => x.sec));
    // The lead-in's own "go" beep lands on the top of rep 1, so the track
    // leaves out its first "go" when there is a lead-in.
    const ctrl = scheduleClickPattern({ beats, cycleSeconds, cycles: reps, startDelay: lead, skipFirst: lead > 0 });
    trackCtrlRef.current = { cancel: () => { cancelLead(); ctrl.cancel(); } };
    runDisplay(ctrl.startAt, reps, cycleSeconds, 'track');
  }, [phasesKey, leadIn, typed, rangeTop, visual, stopTrack, setGlow]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSet = () => {
    if (trackCtrlRef.current) { stop(); return; }
    startSet();
  };

  const toggleVisual = () => { writeFlag(VISUAL_KEY, !visual); setStoredVisual(!visual); if (visual) setGlow(false); };
  const toggleTrackForWorkout = () => {
    const off = !trackOff;
    try {
      if (workoutKey != null) {
        if (off) sessionStorage.setItem(TRACK_OFF_KEY + workoutKey, '1');
        else sessionStorage.removeItem(TRACK_OFF_KEY + workoutKey);
      }
    } catch { /* not kept */ }
    if (off) stop();
    setTrackOff(off);
  };

  if (!hasTempo) {
    return { tempoLine: null, guideView: null, running: false, trackAvailable: false, trackRunning: false, startTrack, stopTrack };
  }

  const trackRunning = !!track;
  const setRunning = track?.kind === 'set';

  // Why Start Set would be silent, shown under the button.
  let silentReason = null;
  if (!trackPref) silentReason = <>Tempo clicks are off in Settings &amp; Preferences › App Settings.</>;
  else if (trackOff) silentReason = <>Tempo clicks are off for this workout (Tempo Guide).</>;
  else if (!soundOn) {
    silentReason = (
      <>Workout sounds are off (the Timers&apos; Sound switch).{' '}
        <button type="button" className="aw-link-btn" onClick={() => setTimerAudioEnabled(true)}>Turn on</button>
      </>
    );
  }

  const tempoLine = (
    <div className="aw-tempo">
      <div className="aw-tempo-row">
        <span className="aw-tempo-label">Tempo: <strong>{formatTempo(e, p, c)}</strong></span>
        {phases.length > 0 && (
          <button type="button" className={`aw-start-set-btn ${trackRunning ? 'running' : ''}`} onClick={toggleSet}
            aria-pressed={trackRunning}>
            {trackRunning ? '■ Stop' : `▶ Start Set · ${setReps} reps`}
          </button>
        )}
        <button type="button" className={`aw-tempo-guide-btn ${visual ? 'on' : ''}`}
          onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen}>
          Tempo Guide
        </button>
      </div>
      {phases.length > 0 && needsRepsField && typed === null && (
        <label className="aw-set-reps">
          Reps for this set
          <input
            type="number" inputMode="numeric" min="1" max={MAX_SET_REPS} step="1"
            value={fieldReps}
            disabled={setRunning}
            onChange={ev => setRepsDraft(ev.target.value)}
            onBlur={() => { if (!positiveInt(fieldReps)) setRepsDraft(null); }}
          />
        </label>
      )}
      {phases.length > 0 && silentReason && !trackRunning && (
        <p className="aw-tempo-hint aw-sound-off">{silentReason}</p>
      )}
      {panelOpen && (
        <div className="aw-tempo-panel">
          <label className="aw-switch">
            <input type="checkbox" checked={visual} onChange={toggleVisual} />
            Visual guide (glow)
          </label>
          {trackPref ? (
            <label className="aw-switch">
              <input type="checkbox" checked={!trackOff} onChange={toggleTrackForWorkout} />
              Tempo clicks (this workout)
            </label>
          ) : (
            <p className="aw-tempo-hint">Tempo clicks are off in Settings &amp; Preferences › App Settings.</p>
          )}
          <TestSoundButton />
        </div>
      )}
    </div>
  );

  let guideView = null;
  if (track) {
    guideView = (
      <div className="aw-tempo-run aw-tempo-track-run" role="status" aria-live="polite">
        <span className="aw-tempo-phase">
          {track.leadIn ? 'Get ready' : `Rep ${track.rep}${Number.isFinite(track.of) ? ` of ${track.of}` : ''} · ${track.phase}`}
        </span>
        <span className="aw-tempo-count">{track.count}</span>
      </div>
    );
  }

  return { tempoLine, guideView, running: trackRunning, trackAvailable, trackRunning, startTrack, stopTrack };
}
