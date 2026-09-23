import { useState, useEffect, useRef, useCallback } from 'react';
import { playTempoTick, playTempoTransition, primeAudio } from './audioCues';
import { formatTempo } from './RoutineExerciseExtras';
import { useUserPrefs } from '../contexts/UserPrefsContext';

const VISUAL_KEY = 'ripfit_tempo_visual';
const AUDIO_KEY = 'ripfit_tempo_audio';
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

/**
 * Tempo guide for the current exercise (Feature 8c/8d).
 *
 * Returns pieces for the caller to place: the "Tempo: 3-1-2" line with its
 * guide settings, a "Start Rep" button for beside Complete Set, and the live
 * phase countdown. `onGlow(bool)` drives the card / screen-edge glow.
 *
 * Toggle state: localStorage wins once set; until then the user's
 * tempo_visual_enabled / tempo_audio_enabled preferences are the default.
 */
export function useTempoGuide({ exerciseKey, eccentric, pause, concentric, onGlow }) {
  const { prefs } = useUserPrefs();
  const [storedVisual, setStoredVisual] = useState(() => readFlag(VISUAL_KEY));
  const [storedAudio, setStoredAudio] = useState(() => readFlag(AUDIO_KEY));
  const [panelOpen, setPanelOpen] = useState(false);
  const [run, setRun] = useState(null);   // { phase, count } while a rep is guided

  const visual = storedVisual ?? !!prefs.tempo_visual_enabled;
  const audio = storedAudio ?? !!prefs.tempo_audio_enabled;

  const toNum = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const e = toNum(eccentric), p = toNum(pause), c = toNum(concentric);
  const hasTempo = e !== null || p !== null || c !== null;
  const phases = [['Eccentric', e], ['Pause', p], ['Concentric', c]]
    .filter(([, sec]) => Number.isFinite(sec) && sec > 0)
    .map(([name, sec]) => ({ name, sec }));

  const timerRef = useRef(null);
  const glowRef = useRef(false);
  const onGlowRef = useRef(onGlow);
  onGlowRef.current = onGlow;

  const setGlow = useCallback((on) => {
    if (glowRef.current === on) return;
    glowRef.current = on;
    onGlowRef.current?.(on);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setGlow(false);
    setRun(null);
  }, [setGlow]);

  // A different exercise, or leaving the view, ends any guide in progress.
  useEffect(() => stop, [exerciseKey, stop]);

  const startRep = () => {
    if (timerRef.current) { stop(); return; }   // second tap cancels
    if (phases.length === 0) return;
    primeAudio();
    const startedAt = Date.now();
    let lastTickKey = null;

    const step = () => {
      const t = (Date.now() - startedAt) / 1000;
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
        else playTempoTick();
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

  const toggleVisual = () => { writeFlag(VISUAL_KEY, !visual); setStoredVisual(!visual); if (visual) setGlow(false); };
  const toggleAudio = () => { writeFlag(AUDIO_KEY, !audio); setStoredAudio(!audio); };

  if (!hasTempo) return { tempoLine: null, startRepButton: null, guideView: null, running: false };

  const guideOn = visual || audio;

  const tempoLine = (
    <div className="aw-tempo">
      <div className="aw-tempo-row">
        <span className="aw-tempo-label">Tempo: <strong>{formatTempo(e, p, c)}</strong></span>
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
        </div>
      )}
    </div>
  );

  const startRepButton = guideOn && phases.length > 0 ? (
    <button type="button" className={`aw-start-rep-btn ${run ? 'running' : ''}`} onClick={startRep}>
      {run ? 'Stop' : 'Start Rep'}
    </button>
  ) : null;

  const guideView = run && visual ? (
    <div className="aw-tempo-run" role="status" aria-live="polite">
      <span className="aw-tempo-phase">{run.phase}</span>
      <span className="aw-tempo-count">{run.count}</span>
    </div>
  ) : null;

  return { tempoLine, startRepButton, guideView, running: !!run };
}
