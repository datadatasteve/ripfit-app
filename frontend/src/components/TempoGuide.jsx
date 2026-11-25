import { useState, useEffect, useRef, useCallback } from 'react';
import {
  playTempoTick, playTempoTransition, primeAudio, scheduleCountdownBeeps, LEAD_IN_INTERVAL_MS,
  scheduleClickPattern, tempoClickBeats,
} from './audioCues';
import { formatTempo } from './RoutineExerciseExtras';
import { useUserPrefs } from '../contexts/UserPrefsContext';

const VISUAL_KEY = 'ripfit_tempo_visual';
const AUDIO_KEY = 'ripfit_tempo_audio';
// Tempo track switched off for one workout (Phase 0B-1b): sessionStorage key
// per workout id, so it lasts through a reload but not into the next workout.
const TRACK_OFF_KEY = 'ripfit_tempo_track_off:';
const FADE_OUT_S = 0.5;

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

/**
 * Tempo guide for the current exercise (Feature 8c/8d; tempo track 0B-1b).
 *
 * Returns pieces for the caller to place:
 *   tempoLine       "Tempo: 3-1-2", the Tempo track button and the guide settings
 *   startRepButton  the single-rep guide (Start Rep), when a guide switch is on
 *   guideView       the live phase countdown (single rep or track)
 *   startTrack / stopTrack / trackRunning  for the Timers tie-in
 * `onGlow(bool)` drives the card / screen-edge glow.
 *
 * Tempo is stored as three parts (routine_exercises.tempo_eccentric / _pause /
 * _concentric, migration 024). The click track takes any list of phases, so a
 * fourth part would only need passing in.
 *
 * Toggle state: localStorage wins once set; until then the user's
 * tempo_visual_enabled / tempo_audio_enabled preferences are the default.
 */
export function useTempoGuide({ exerciseKey, workoutKey = null, eccentric, pause, concentric, targetReps = null, onGlow }) {
  const { prefs } = useUserPrefs();
  const [storedVisual, setStoredVisual] = useState(() => readFlag(VISUAL_KEY));
  const [storedAudio, setStoredAudio] = useState(() => readFlag(AUDIO_KEY));
  const [panelOpen, setPanelOpen] = useState(false);
  const [run, setRun] = useState(null);     // { phase, count } while a single rep is guided
  const [track, setTrack] = useState(null); // { rep, of, phase, count, leadIn } while the track plays
  const [trackOff, setTrackOff] = useState(() => readTrackOff(workoutKey));

  useEffect(() => { setTrackOff(readTrackOff(workoutKey)); }, [workoutKey]);

  const visual = storedVisual ?? !!prefs.tempo_visual_enabled;
  const audio = storedAudio ?? !!prefs.tempo_audio_enabled;
  const trackPref = prefs.tempo_click_track_enabled !== false;

  const toNum = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const e = toNum(eccentric), p = toNum(pause), c = toNum(concentric);
  const hasTempo = e !== null || p !== null || c !== null;
  const phases = [['Eccentric', e], ['Pause', p], ['Concentric', c]]
    .filter(([, sec]) => Number.isFinite(sec) && sec > 0)
    .map(([name, sec]) => ({ name, sec: Math.round(sec) }));
  const phasesKey = phases.map(x => x.sec).join('-');

  const trackAvailable = trackPref && !trackOff && phases.length > 0;

  // Lead-in before the rep (Phase 0B-1): N beeps, then a higher "go" beep
  // as the first phase starts. 0 = no lead-in.
  const leadIn = Math.max(0, Math.min(5, Math.round(Number(prefs.tempo_countdown_beeps ?? 3) || 0)));

  const timerRef = useRef(null);
  const cancelAudioRef = useRef(null);
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

  const stopRep = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    cancelAudioRef.current?.();
    cancelAudioRef.current = null;
    setRun(null);
  }, []);

  const stopTrack = useCallback(() => {
    if (trackTimerRef.current) clearInterval(trackTimerRef.current);
    trackTimerRef.current = null;
    trackCtrlRef.current?.cancel();
    trackCtrlRef.current = null;
    setTrack(null);
  }, []);

  const stop = useCallback(() => {
    stopRep();
    stopTrack();
    setGlow(false);
  }, [stopRep, stopTrack, setGlow]);

  // A different exercise, a different tempo, or leaving the view ends any
  // guide or track in progress.
  useEffect(() => stop, [exerciseKey, phasesKey, stop]);

  const startRep = () => {
    if (timerRef.current) { stop(); return; }   // second tap cancels
    if (phases.length === 0) return;
    stopTrack();
    primeAudio();
    // Beeps are queued now, inside the tap (iOS needs that); the rep itself
    // starts when the "go" beep plays. Mute and the Audio ticks switch apply.
    cancelAudioRef.current = audio ? scheduleCountdownBeeps(leadIn) : null;
    const startedAt = Date.now() + leadIn * LEAD_IN_INTERVAL_MS;
    let lastTickKey = null;

    const step = () => {
      const t = (Date.now() - startedAt) / 1000;
      if (t < 0) {
        // Lead-in: count down to the first phase. No glow, no phase ticks.
        setGlow(false);
        setRun({ phase: 'Get ready', count: Math.ceil(-t) });
        return;
      }
      let acc = 0;
      let k = -1;
      for (let i = 0; i < phases.length; i++) {
        if (t < acc + phases[i].sec) { k = i; break; }
        acc += phases[i].sec;
      }
      if (k === -1) {
        if (audio) playTempoTransition();   // marks the end of the rep
        stop();
        return;
      }
      const inPhase = t - acc;
      const second = Math.floor(inPhase);
      // One audible cue per second; the first second of a new phase gets the
      // higher transition tick instead of the regular one.
      const key = `${k}:${second}`;
      if (audio && key !== lastTickKey) {
        if (k > 0 && second === 0) playTempoTransition();
        else if (!(k === 0 && second === 0 && leadIn > 0)) playTempoTick();   // the "go" beep stands in for it
      }
      lastTickKey = key;
      // Glow: fade in at the phase start, hold, fade out over the last 0.5 s.
      // One cycle per phase — never faster than once a second.
      if (visual) setGlow(inPhase < phases[k].sec - FADE_OUT_S);
      setRun({ phase: phases[k].name, count: Math.max(1, Math.ceil(phases[k].sec - inPhase)) });
    };

    step();
    timerRef.current = setInterval(step, 100);
  };

  /**
   * The tempo click track: a click for every second of every phase, rep after
   * rep, until Stop or `targetReps`. Call from a tap. `withLeadIn` false is for
   * the Timers tie-in, where the timer's own start marks the beginning.
   */
  const startTrack = useCallback(({ withLeadIn = true } = {}) => {
    if (phases.length === 0) return;
    stopRep();
    stopTrack();
    primeAudio();
    const lead = withLeadIn ? leadIn : 0;
    const reps = Number.isInteger(targetReps) && targetReps > 0 ? targetReps : Infinity;
    const cancelLead = lead > 0 ? scheduleCountdownBeeps(lead) : () => {};
    const { beats, cycleSeconds } = tempoClickBeats(phases.map(x => x.sec));
    // The lead-in's own "go" beep lands on the top of rep 1, so the track
    // leaves out its first "go" when there is a lead-in.
    const ctrl = scheduleClickPattern({ beats, cycleSeconds, cycles: reps, startDelay: lead, skipFirst: lead > 0 });
    trackCtrlRef.current = { cancel: () => { cancelLead(); ctrl.cancel(); } };

    const step = () => {
      const t = (performance.now() - ctrl.startAt) / 1000;
      if (t < 0) {
        setGlow(false);
        setTrack({ rep: 0, of: reps, phase: 'Get ready', count: Math.ceil(-t), leadIn: true });
        return;
      }
      const repIdx = Math.floor(t / cycleSeconds);
      if (repIdx >= reps) {
        stopTrack();
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
      setTrack({ rep: repIdx + 1, of: reps, phase: phases[k].name, count: Math.max(1, Math.ceil(phases[k].sec - inPhase)), leadIn: false });
    };
    step();
    trackTimerRef.current = setInterval(step, 100);
  }, [phasesKey, leadIn, targetReps, visual, stopRep, stopTrack, setGlow]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTrack = () => {
    if (trackCtrlRef.current) { stopTrack(); setGlow(false); return; }
    startTrack();
  };

  const toggleVisual = () => { writeFlag(VISUAL_KEY, !visual); setStoredVisual(!visual); if (visual) setGlow(false); };
  const toggleAudio = () => { writeFlag(AUDIO_KEY, !audio); setStoredAudio(!audio); };
  const toggleTrackForWorkout = () => {
    const off = !trackOff;
    try {
      if (workoutKey != null) {
        if (off) sessionStorage.setItem(TRACK_OFF_KEY + workoutKey, '1');
        else sessionStorage.removeItem(TRACK_OFF_KEY + workoutKey);
      }
    } catch { /* not kept */ }
    if (off) { stopTrack(); setGlow(false); }
    setTrackOff(off);
  };

  if (!hasTempo) {
    return { tempoLine: null, startRepButton: null, guideView: null, running: false, trackAvailable: false, trackRunning: false, startTrack, stopTrack };
  }

  const guideOn = visual || audio;
  const trackRunning = !!track;

  const tempoLine = (
    <div className="aw-tempo">
      <div className="aw-tempo-row">
        <span className="aw-tempo-label">Tempo: <strong>{formatTempo(e, p, c)}</strong></span>
        {trackAvailable && (
          <button type="button" className={`aw-tempo-track-btn ${trackRunning ? 'running' : ''}`} onClick={toggleTrack}
            aria-pressed={trackRunning}>
            {trackRunning ? '■ Stop track' : '♪ Tempo track'}
          </button>
        )}
        <button type="button" className={`aw-tempo-guide-btn ${guideOn ? 'on' : ''}`}
          onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen}>
          Tempo Guide {guideOn ? '· on' : ''}
        </button>
      </div>
      {panelOpen && (
        <div className="aw-tempo-panel">
          <label className="aw-switch">
            <input type="checkbox" checked={visual} onChange={toggleVisual} />
            Visual guide (glow + countdown)
          </label>
          <label className="aw-switch">
            <input type="checkbox" checked={audio} onChange={toggleAudio} />
            Audio ticks
          </label>
          {!guideOn && <p className="aw-tempo-hint">Turn one on to get a Start Rep button.</p>}
          {trackPref ? (
            <label className="aw-switch">
              <input type="checkbox" checked={!trackOff} onChange={toggleTrackForWorkout} />
              Tempo click track (this workout)
            </label>
          ) : (
            <p className="aw-tempo-hint">The Tempo click track is off in Settings &amp; Preferences › App Settings.</p>
          )}
        </div>
      )}
    </div>
  );

  const startRepButton = guideOn && phases.length > 0 ? (
    <button type="button" className={`aw-start-rep-btn ${run ? 'running' : ''}`} onClick={startRep}>
      {run ? 'Stop' : 'Start Rep'}
    </button>
  ) : null;

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
  } else if (run && visual) {
    guideView = (
      <div className="aw-tempo-run" role="status" aria-live="polite">
        <span className="aw-tempo-phase">{run.phase}</span>
        <span className="aw-tempo-count">{run.count}</span>
      </div>
    );
  }

  return { tempoLine, startRepButton, guideView, running: !!run || trackRunning, trackAvailable, trackRunning, startTrack, stopTrack };
}
