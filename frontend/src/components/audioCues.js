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

const TIMER_AUDIO_EVENT = 'ripfit:timer-audio';

export function setTimerAudioEnabled(on) {
  try {
    localStorage.setItem(TIMER_AUDIO_KEY, String(!!on));
  } catch {
    /* storage unavailable — preference just won't persist */
  }
  // Every Sound switch and "Turn on" link on screen follows the change.
  try { window.dispatchEvent(new CustomEvent(TIMER_AUDIO_EVENT, { detail: !!on })); } catch { /* no window */ }
}

/** Calls `fn(on)` whenever the timer Sound switch changes. Returns an unsubscribe. */
export function onTimerAudioChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const handler = e => fn(!!e.detail);
  window.addEventListener(TIMER_AUDIO_EVENT, handler);
  return () => window.removeEventListener(TIMER_AUDIO_EVENT, handler);
}

function audioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function getCtx() {
  const AudioCtor = audioCtor();
  if (!AudioCtor) return null;
  if (!ctx || ctx.state === 'closed') ctx = new AudioCtor();
  // 'interrupted' is iOS's state after a call or another app took the audio.
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * One blip at audio-clock time `t` (a sine unless `type` says otherwise).
 * `sustain` holds the level for the whole duration and then releases over
 * 40 ms (a steady beep) instead of decaying from the start (a click).
 * Returns the oscillator (stoppable).
 */
function tone(ac, t, frequency, duration, volume, type = 'sine', sustain = false) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  if (sustain) {
    gain.gain.setValueAtTime(volume, t + Math.max(0.02, duration - 0.04));
    gain.gain.linearRampToValueAtTime(0.0001, t + duration);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  }
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
  return osc;
}

/** Short blip used at interval/round transitions. Silent when timer audio is off. */
export function playBeep({ frequency = 880, duration = 0.18, volume = 0.25 } = {}) {
  if (!isTimerAudioEnabled()) return;
  try {
    const ac = getCtx();
    if (!ac) return;
    tone(ac, ac.currentTime, frequency, duration, volume);
  } catch {
    /* audio is a nicety — never let it break the timer */
  }
}

// ── Countdown lead-in (Phase 0B-1; Phase 3-2 reuses it) ────────────────────
export const LEAD_IN_INTERVAL_MS = 1000;
export const LEAD_IN_TONE_HZ = 660;
export const LEAD_IN_GO_HZ = 990;

/**
 * Schedules a countdown on the audio clock: `count` beeps one interval apart
 * at one tone, then a higher "go" beep one interval after the last, i.e. at
 * count × interval from now (when the movement starts). Everything is queued
 * at once, inside the user's tap, so iOS (which only starts audio from a
 * gesture) plays the whole sequence. Silent when the timer Sound switch is
 * off. Returns a function that cancels whatever hasn't played yet.
 */
export function scheduleCountdownBeeps(count, { intervalMs = LEAD_IN_INTERVAL_MS, frequency = LEAD_IN_TONE_HZ, goFrequency = LEAD_IN_GO_HZ } = {}) {
  const n = Math.max(0, Math.min(5, Math.round(Number(count) || 0)));
  if (n === 0 || !isTimerAudioEnabled()) return () => {};
  try {
    const ac = getCtx();
    if (!ac) return () => {};
    const t0 = ac.currentTime + 0.05;
    const step = intervalMs / 1000;
    const oscs = [];
    // Triangle waves (Phase 0B-1b): same pitches, more audible on phone speakers.
    for (let i = 0; i < n; i++) oscs.push(tone(ac, t0 + i * step, frequency, 0.14, 0.4, 'triangle'));
    oscs.push(tone(ac, t0 + n * step, goFrequency, 0.28, 0.45, 'triangle'));
    return () => oscs.forEach(o => { try { o.stop(); } catch { /* already done */ } });
  } catch {
    return () => {};
  }
}

/**
 * Call inside a tap, before any cue that plays later. Resumes the shared
 * audio context, and (Phase 0B-2) when it still isn't running, replaces it
 * with a new one made inside this tap: a context first made outside a tap,
 * or one the phone stopped, can refuse to resume on some Android browsers,
 * while a context made during a tap starts running. Nothing audible is lost,
 * since a context that isn't running plays nothing. A one-sample silent
 * buffer is also played, the usual way to unlock audio output on phones.
 */
export function primeAudio() {
  const AudioCtor = audioCtor();
  if (!AudioCtor) return null;
  try {
    let ac = getCtx();
    if (ac && ac.state !== 'running') {
      const old = ac;
      ac = new AudioCtor();
      ctx = ac;
      old.close?.().catch(() => {});
      if (ac.state !== 'running') ac.resume().catch(() => {});
    }
    const buf = ac.createBuffer(1, 1, ac.sampleRate);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(0);
    return ac;
  } catch {
    return null;
  }
}

/**
 * What stands between a cue and the speaker, for the Test sound readout:
 *   supported   the browser has Web Audio
 *   state       the shared context's state ('running', 'suspended', ...)
 *   soundOn     the timer Sound switch (ripfit_timer_audio)
 */
export function audioStatus() {
  return {
    supported: !!audioCtor(),
    state: ctx ? ctx.state : 'not started',
    soundOn: isTimerAudioEnabled(),
  };
}

// ── Clicks and click tracks (Phase 0B-1b; Phase 3-2 reuses them) ───────────
// Square waves in the 1 to 2 kHz range: phone speakers reproduce that band
// well, unlike the quiet 800 Hz sine ticks used before (0.08 gain, 50 ms),
// which were close to inaudible on a phone. The timer Sound switch
// (ripfit_timer_audio) silences every click.

export const CLICK_SOUNDS = Object.freeze({
  /** Every second inside a phase. */
  tick:   { frequency: 1047, duration: 0.035, volume: 0.28, type: 'square' },
  /** First second of a phase (phase change). */
  accent: { frequency: 1568, duration: 0.06,  volume: 0.36, type: 'square' },
  /** Top of each rep ("go"). Longer and higher, so it can't be mistaken. */
  go:     { frequency: 2093, duration: 0.14,  volume: 0.4,  type: 'square' },
  /**
   * End of a rep (Start Set, Phase 0B-2): a steady half-second beep, lower
   * than the clicks and smooth rather than buzzy, so it can't be taken for one.
   */
  rep:    { frequency: 784,  duration: 0.5,   volume: 0.5,  type: 'triangle', sustain: true },
});

function scheduleClick(ac, t, sound) {
  const s = CLICK_SOUNDS[sound] || CLICK_SOUNDS.tick;
  return tone(ac, t, s.frequency, s.duration, s.volume, s.type, !!s.sustain);
}

/** One click now ('tick' | 'accent' | 'go'). Silent when timer audio is off. */
export function playClick(sound = 'tick') {
  if (!isTimerAudioEnabled()) return;
  try {
    const ac = getCtx();
    if (ac) scheduleClick(ac, ac.currentTime, sound);
  } catch {
    /* audio is a nicety */
  }
}

/**
 * The beats of one tempo rep: one click per second of every phase, in order.
 * The first second of the first phase is the "go"; the first second of each
 * later phase is an accent; every other second is a tick. Phases of 0 s are
 * skipped. `phaseSeconds` is e.g. [3, 1, 2] for a 3-1-2 tempo (any number of
 * phases, so a four-part tempo works the same way).
 * Returns { beats: [{ at, sound, phase, second }], cycleSeconds }.
 */
export function tempoClickBeats(phaseSeconds) {
  const beats = [];
  let at = 0;
  let phaseNo = 0;
  (phaseSeconds || []).forEach((raw, idx) => {
    const sec = Math.max(0, Math.round(Number(raw) || 0));
    if (sec === 0) return;
    for (let i = 0; i < sec; i++) {
      beats.push({ at: at + i, sound: i === 0 ? (phaseNo === 0 ? 'go' : 'accent') : 'tick', phase: idx, second: i });
    }
    at += sec;
    phaseNo++;
  });
  return { beats, cycleSeconds: at };
}

/**
 * The beats of a whole tempo set (Start Set, Phase 0B-2): `reps` reps back to
 * back, one click per second of every phase, an accent on the first second
 * of each later phase, and a half-second 'rep' beep at the end of every rep
 * (the last one ends the set). The end-of-rep beep also marks the top of the
 * next rep, so the first second of reps 2 onwards has no click of its own.
 * Rep 1's first second is marked by the lead-in's "go" when `leadIn` is
 * true, else by an accent. Nothing follows the last beep.
 * Returns { beats, cycleSeconds, totalSeconds } (cycleSeconds = one rep).
 */
export function tempoSetBeats(phaseSeconds, reps, { leadIn = true } = {}) {
  const { beats: one, cycleSeconds } = tempoClickBeats(phaseSeconds);
  const n = Math.max(0, Math.floor(Number(reps) || 0));
  const beats = [];
  if (!(cycleSeconds > 0) || n === 0) return { beats, cycleSeconds, totalSeconds: 0 };
  for (let r = 0; r < n; r++) {
    const base = r * cycleSeconds;
    for (const b of one) {
      let sound = b.sound;
      if (sound === 'go') {
        if (r > 0 || leadIn) continue;   // the rep beep / the lead-in "go" stands in
        sound = 'accent';
      }
      beats.push({ at: base + b.at, sound, phase: b.phase, second: b.second, rep: r });
    }
    beats.push({ at: base + cycleSeconds, sound: 'rep', rep: r });
  }
  return { beats, cycleSeconds, totalSeconds: n * cycleSeconds + CLICK_SOUNDS.rep.duration };
}

/**
 * Schedules a repeating click pattern on the shared audio clock.
 *   beats        [{ at, sound }] within one cycle (seconds from the cycle start)
 *   cycleSeconds length of one cycle
 *   cycles       how many cycles (Infinity = until cancelled)
 *   startDelay   seconds before the first cycle (e.g. a lead-in)
 *   skipFirst    leave out the first beat of the first cycle (a lead-in's own
 *                "go" beep already marks it)
 * Clicks are queued a little ahead of time by a short timer (a look-ahead
 * scheduler), so timing stays exact and a long run doesn't queue thousands of
 * nodes. Muting the Sound switch mid-run silences later clicks. Call from a
 * tap (or after primeAudio() in one) so iOS lets the audio start.
 * Returns { cancel(), startAt } where startAt is performance.now()-based ms of
 * the first cycle's start (for keeping a display in step).
 */
export function scheduleClickPattern({ beats, cycleSeconds, cycles = Infinity, startDelay = 0, skipFirst = false }) {
  const noop = { cancel: () => {}, startAt: performance.now() + startDelay * 1000 };
  if (!beats?.length || !(cycleSeconds > 0)) return noop;
  let ac;
  try { ac = getCtx(); } catch { ac = null; }
  const startAt = performance.now() + startDelay * 1000;
  if (!ac) return { ...noop, startAt };

  const t0 = ac.currentTime + 0.05 + startDelay;
  const LOOKAHEAD = 0.35;            // seconds queued ahead
  const oscs = new Set();
  let cycle = 0;
  let beatIdx = skipFirst ? 1 : 0;
  let done = false;

  const pump = () => {
    if (done) return;
    const horizon = ac.currentTime + LOOKAHEAD;
    while (cycle < cycles) {
      if (beatIdx >= beats.length) { cycle++; beatIdx = 0; continue; }
      const when = t0 + cycle * cycleSeconds + beats[beatIdx].at;
      if (when > horizon) break;
      if (when >= ac.currentTime - 0.02 && isTimerAudioEnabled()) {
        try {
          const o = scheduleClick(ac, when, beats[beatIdx].sound);
          oscs.add(o);
          o.onended = () => oscs.delete(o);
        } catch { /* skip this click */ }
      }
      beatIdx++;
    }
    if (cycle >= cycles) { done = true; clearInterval(timer); }
  };

  const timer = setInterval(pump, 50);
  pump();
  return {
    startAt,
    cancel: () => {
      done = true;
      clearInterval(timer);
      oscs.forEach(o => { try { o.stop(); } catch { /* already done */ } });
      oscs.clear();
    },
  };
}

/**
 * Test sound (Phase 0B-2): a tick, an accent click and the end-of-rep beep,
 * 0.6 s apart. Call from the tap. It plays even when the timer Sound switch
 * is off (it tests the phone, not the setting); `audioStatus()` says whether
 * that switch would silence the workout sounds.
 */
export function playTestSound() {
  const ac = primeAudio();
  if (!ac) return false;
  try {
    const t0 = ac.currentTime + 0.08;
    scheduleClick(ac, t0, 'tick');
    scheduleClick(ac, t0 + 0.6, 'accent');
    scheduleClick(ac, t0 + 1.2, 'rep');
    return true;
  } catch {
    return false;
  }
}

// ── Tempo guide ticks (Feature 8d) ─────────────────────────────────────────
// The single-rep guide (Start Rep) uses the same audible clicks as the track.

/** Once per second during a tempo phase countdown. */
export function playTempoTick() {
  playClick('tick');
}

/** Once when moving from one tempo phase to the next. */
export function playTempoTransition() {
  playClick('accent');
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
