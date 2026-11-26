// Minimal WebAudio: an engine hum that follows the throttle, a chime for a ring,
// a thud for a touchdown. Everything is guarded — no audio context, no sound, no error.
// Sound only starts after a user gesture, as browsers require.
export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let enabled = true;
  let started = false;

  function ensure() {
    if (ctx || !enabled) return ctx !== null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineGain.connect(ctx.destination);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.connect(engineGain);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc.connect(filter);
      engineOsc.start();
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 82;
      engineOsc2.connect(filter);
      engineOsc2.start();
      started = true;
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function note(freq, delay, dur, type = 'sine', vol = 0.16) {
    if (!ctx || !enabled) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + dur + 0.05);
    } catch { /* silence is fine */ }
  }

  return {
    /** Call on the first user gesture. */
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    toggle() {
      enabled = !enabled;
      if (!enabled && engineGain) engineGain.gain.value = 0;
      return enabled;
    },
    /** Set the sound state directly (the menu system is the single source of
     *  truth for it — the HUD button, the title button and the pause menu all
     *  write through here, so they can never disagree). */
    set(on) {
      enabled = !!on;
      if (!enabled && engineGain) engineGain.gain.value = 0;
      return enabled;
    },
    isEnabled() {
      return enabled;
    },
    /** Continuous hum; call every frame with throttle 0..100. */
    engine(throttle, airborne) {
      if (!started || !enabled || !ctx) return;
      try {
        const f = 48 + throttle * 0.85;
        engineOsc.frequency.value = f;
        engineOsc2.frequency.value = f * 1.5;
        engineGain.gain.value = airborne ? 0.05 + (throttle / 100) * 0.05 : (throttle / 100) * 0.04;
      } catch { /* silence is fine */ }
    },
    ring() {
      note(880, 0, 0.35);
      note(1318, 0.09, 0.4);
    },
    thud() {
      note(70, 0, 0.25, 'triangle', 0.3);
    },
    crash() {
      note(55, 0, 0.6, 'sawtooth', 0.25);
      note(41, 0.1, 0.7, 'sawtooth', 0.2);
    },
  };
}
