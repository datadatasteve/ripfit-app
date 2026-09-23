/**
 * Shared WebAudio cue generator.
 *
 * No audio files are shipped — every cue is synthesised on the fly. This keeps
 * the bundle free of binary assets and lets each cue fade in gradually, which
 * the meditation timer requires.
 */

let ctx = null;

const TIMER_AUDIO_KEY = 'ripfit_timer_audio';

/** Timer-mode audio preference. Defaults to on when nothing is stored. */
export function isTimerAudioEnabled() {
  try {
    const stored = localStorage.getItem(TIMER_AUDIO_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function setTimerAudioEnabled(on) {
  try {
    localStorage.setItem(TIMER_AUDIO_KEY, String(!!on));
  } catch {
    /* storage unavailable — preference just won't persist */
  }
}

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Short blip used at interval/round transitions. Silent when timer audio is off. */
export function playBeep({ frequency = 880, duration = 0.18, volume = 0.25 } = {}) {
  if (!isTimerAudioEnabled()) return;
  try {
    const ac = getCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const now = ac.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  } catch {
    /* audio is a nicety — never let it break the timer */
  }
}

/** Resumes the audio context inside a user gesture so later scheduled cues can play. */
export function primeAudio() {
  getCtx();
}

// ── Tempo guide ticks (Feature 8d) ─────────────────────────────────────────
// Both go through playBeep, so the global timer Sound toggle silences them too.

/** Once per second during a tempo phase countdown. */
export function playTempoTick() {
  playBeep({ frequency: 800, duration: 0.05, volume: 0.08 });
}

/** Once when moving from one tempo phase to the next. */
export function playTempoTransition() {
  playBeep({ frequency: 1050, duration: 0.08, volume: 0.1 });
}

// ── Meditation bowl (Feature 9f) ───────────────────────────────────────────

const MEDITATION_SOUND_KEY = 'ripfit_meditation_sound';

export const DEFAULT_MEDITATION_SOUND = {
  fundamental: 432,
  extra1: { enabled: false, freq: 540 },
  extra2: { enabled: false, freq: 648 },
  attackMs: 30,
  decayMs: 200,
  ringOutMs: 4000,
  volume: 70,                 // 0–100, relative gain inside Web Audio
  ringCount: 1,               // strikes per alarm event
  ringIntervalMs: 1000,       // gap between strikes when ringCount > 1
  ringTiming: 'segment',      // 'session' | 'segment' | 'interval'
  intervalMinutes: 5,         // used when ringTiming === 'interval'
  eq: { low: 0, mid: 0, high: 0 },   // dB, ±12
  reverb: 20,                 // wet %, 0–100
  chorus: 0,                  // depth %, 0–100
};

/** Stored settings merged over the defaults, so new keys never come back undefined. */
export function loadMeditationSound() {
  try {
    const raw = JSON.parse(localStorage.getItem(MEDITATION_SOUND_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_MEDITATION_SOUND);
    return {
      ...DEFAULT_MEDITATION_SOUND,
      ...raw,
      extra1: { ...DEFAULT_MEDITATION_SOUND.extra1, ...(raw.extra1 || {}) },
      extra2: { ...DEFAULT_MEDITATION_SOUND.extra2, ...(raw.extra2 || {}) },
      eq: { ...DEFAULT_MEDITATION_SOUND.eq, ...(raw.eq || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_MEDITATION_SOUND);
  }
}

export function saveMeditationSound(settings) {
  try {
    localStorage.setItem(MEDITATION_SOUND_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

// Inharmonic partial stack of a struck bowl. `end` is when the partial reaches
// silence as a fraction of the ring-out (2500/1800/1200 ms at the 4000 ms
// default); `beat` marks the partials that get the slow amplitude wobble.
const BOWL_PARTIALS = [
  { ratio: 1,     level: 1.0,  end: 1,              beat: false },
  { ratio: 2.756, level: 0.5,  end: 2500 / 4000,    beat: true  },
  { ratio: 5.124, level: 0.25, end: 1800 / 4000,    beat: true  },
  { ratio: 8.2,   level: 0.1,  end: 1200 / 4000,    beat: false },
];
const PARTIAL_SUM = BOWL_PARTIALS.reduce((a, p) => a + p.level, 0);
const EXTRA_PITCH_WEIGHT = 0.7;
const SILENCE = 0.0001;

// Reverb impulse: stereo, 2 s of exponentially decaying white noise. Built
// once per AudioContext and reused.
let impulse = null;
function getImpulse(ac) {
  if (impulse && impulse.sampleRate === ac.sampleRate) return impulse;
  const seconds = 2;
  const length = Math.floor(ac.sampleRate * seconds);
  impulse = ac.createBuffer(2, length, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / ac.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3);
    }
  }
  return impulse;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

/**
 * Builds the shared effects chain for one alarm event and returns its input.
 *   master → low shelf → mid peak → high shelf → chorus (dry + modulated delay)
 *          → split: dry bypass + convolver (wet) → destination
 */
function buildChain(ac, s, stopAt) {
  const master = ac.createGain();
  master.gain.value = 1;

  const low = ac.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 200; low.gain.value = clamp(s.eq.low, -12, 12);
  const mid = ac.createBiquadFilter();
  mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1; mid.gain.value = clamp(s.eq.mid, -12, 12);
  const high = ac.createBiquadFilter();
  high.type = 'highshelf'; high.frequency.value = 5000; high.gain.value = clamp(s.eq.high, -12, 12);
  master.connect(low).connect(mid).connect(high);

  // Chorus: 25 ms delay swept by a 0.5 Hz LFO (0–10 ms deep), mixed at equal
  // level with the dry signal. At 0 % the delayed copy is muted entirely so it
  // doesn't leave a fixed 25 ms echo.
  const chorusDepth = clamp(s.chorus, 0, 100) / 100;
  const chorusOut = ac.createGain();
  const chorusDry = ac.createGain();
  const chorusWet = ac.createGain();
  chorusDry.gain.value = chorusDepth > 0 ? 0.7 : 1;
  chorusWet.gain.value = chorusDepth > 0 ? 0.7 : 0;
  high.connect(chorusDry).connect(chorusOut);
  if (chorusDepth > 0) {
    const delay = ac.createDelay(0.1);
    delay.delayTime.value = 0.025;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.5;
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 0.010 * chorusDepth;
    lfo.connect(lfoDepth).connect(delay.delayTime);
    high.connect(delay).connect(chorusWet).connect(chorusOut);
    lfo.start();
    lfo.stop(stopAt);
  }

  // Reverb send: split into dry bypass and convolver, mixed at the wet ratio.
  const wet = clamp(s.reverb, 0, 100) / 100;
  const dryGain = ac.createGain();
  dryGain.gain.value = 1 - wet;
  chorusOut.connect(dryGain).connect(ac.destination);
  if (wet > 0) {
    const convolver = ac.createConvolver();
    convolver.buffer = getImpulse(ac);
    const wetGain = ac.createGain();
    wetGain.gain.value = wet;
    chorusOut.connect(convolver).connect(wetGain).connect(ac.destination);
  }

  return master;
}

/** One strike of every enabled pitch into `master`, starting at time `t0`. */
function strike(ac, master, s, t0) {
  const attack = clamp(s.attackMs, 10, 200) / 1000;
  const decay = clamp(s.decayMs, 50, 500) / 1000;
  const ringOut = clamp(s.ringOutMs, 1000, 8000) / 1000;

  const pitches = [{ freq: clamp(s.fundamental, 200, 800), weight: 1 }];
  if (s.extra1?.enabled) pitches.push({ freq: clamp(s.extra1.freq, 200, 800), weight: EXTRA_PITCH_WEIGHT });
  if (s.extra2?.enabled) pitches.push({ freq: clamp(s.extra2.freq, 200, 800), weight: EXTRA_PITCH_WEIGHT });

  // Scale so the combined peak stays under clipping however many pitches play.
  const totalWeight = pitches.reduce((a, p) => a + p.weight, 0);
  const peakScale = (clamp(s.volume, 0, 100) / 100) * (0.9 / (PARTIAL_SUM * totalWeight));
  if (peakScale <= 0) return t0;

  let lastStop = t0;
  for (const pitch of pitches) {
    for (const partial of BOWL_PARTIALS) {
      const peak = partial.level * pitch.weight * peakScale;
      const end = t0 + Math.max(attack + decay + 0.05, ringOut * partial.end);

      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = pitch.freq * partial.ratio;

      // Envelope: fast percussive attack to the peak (the loudest point),
      // quick fall to 60 %, then exponential ring-out to silence. No plateau.
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(peak, t0 + attack);
      env.gain.linearRampToValueAtTime(peak * 0.6, t0 + attack + decay);
      env.gain.exponentialRampToValueAtTime(SILENCE, end);

      osc.connect(env);
      let out = env;

      if (partial.beat) {
        // ±15 % wobble at ~0.7 Hz applied after the envelope, so it scales
        // down with the decay rather than lingering once the partial is gone.
        const mod = ac.createGain();
        mod.gain.value = 1;
        const lfo = ac.createOscillator();
        lfo.frequency.value = 0.7;
        const depth = ac.createGain();
        depth.gain.value = 0.15;
        lfo.connect(depth).connect(mod.gain);
        env.connect(mod);
        out = mod;
        lfo.start(t0);
        lfo.stop(end + 0.05);
      }

      out.connect(master);
      osc.start(t0);
      osc.stop(end + 0.05);
      lastStop = Math.max(lastStop, end);
    }
  }
  return lastStop;
}

/**
 * Synthesises one alarm event: `ringCount` strikes `ringIntervalMs` apart,
 * all scheduled on the AudioContext clock. Settings are passed in or read
 * from localStorage (ripfit_meditation_sound). Not affected by the workout
 * timer Sound toggle — meditation has its own volume control.
 */
export function playMeditationBowl(settings) {
  try {
    const ac = getCtx();
    if (!ac) return;
    const s = settings || loadMeditationSound();
    const count = Math.round(clamp(s.ringCount, 1, 5));
    const gap = clamp(s.ringIntervalMs, 300, 3000) / 1000;
    const t0 = ac.currentTime + 0.02;
    const tailPad = 2.5;   // reverb impulse length + margin

    const lastStrikeEnd = t0 + (count - 1) * gap + clamp(s.ringOutMs, 1000, 8000) / 1000;
    const master = buildChain(ac, s, lastStrikeEnd + tailPad);
    for (let i = 0; i < count; i++) strike(ac, master, s, t0 + i * gap);
  } catch {
    /* audio is a nicety — never let it break the timer */
  }
}
