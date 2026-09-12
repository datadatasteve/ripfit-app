/**
 * Shared WebAudio cue generator.
 *
 * No audio files are shipped — every cue is synthesised on the fly. This keeps
 * the bundle free of binary assets and lets each cue fade in gradually, which
 * the meditation timer requires.
 */

let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Short blip used at interval/round transitions. */
export function playBeep({ frequency = 880, duration = 0.18, volume = 0.25 } = {}) {
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

/**
 * Singing-bowl style tone: a fundamental plus inharmonic partials, faded in
 * over ~0.6s and left to ring out. Used as the meditation segment alert.
 */
export function playSingingBowl({ fundamental = 432, duration = 7, volume = 0.3 } = {}) {
  try {
    const ac = getCtx();
    if (!ac) return;
    const now = ac.currentTime;
    const master = ac.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume, now + 0.6);   // gradual fade-in
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    master.connect(ac.destination);

    // Inharmonic ratios give the metallic shimmer of a struck bowl.
    [[1, 1], [2.76, 0.45], [5.4, 0.2], [8.9, 0.09]].forEach(([ratio, level]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = fundamental * ratio;
      gain.gain.value = level;
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + duration + 0.1);
    });

    // Slow amplitude beating, the way two bowl partials drift against each other.
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    lfo.frequency.value = 1.6;
    lfoGain.gain.value = volume * 0.12;
    lfo.connect(lfoGain).connect(master.gain);
    lfo.start(now);
    lfo.stop(now + duration + 0.1);
  } catch {
    /* ignore */
  }
}
