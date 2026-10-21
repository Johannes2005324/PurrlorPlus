/**
 * Synthesize short tonal cues for voice join/leave events using Web Audio API.
 * No external audio files required.
 *
 * Ported verbatim from cinny-voice — pure Web Audio, no dependencies.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Create / resume the AudioContext during a user-gesture (click).
 * Browsers block AudioContext.play() unless the context was started inside
 * a trusted event handler. Call this early in the "Join Voice" click path
 * so that later playConnectedSound() / playDisconnectedSound() calls work.
 */
export function warmUpAudioContext(): void {
  try {
    getAudioContext();
  } catch {
    // ignore — best effort
  }
}

/**
 * Play a short two-tone "bloop" sound.
 * @param freqStart - starting frequency (Hz)
 * @param freqEnd   - ending frequency (Hz)
 * @param duration  - total duration (seconds)
 * @param volume    - gain 0..1
 */
export function playTone(freqStart: number, freqEnd: number, duration: number, volume: number) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Audio context unavailable — silently ignore
  }
}

/** Pleasant rising two-tone for someone joining voice. */
export function playJoinSound(volume = 0.25) {
  playTone(440, 660, 0.15, volume);
}

/** Softer falling tone for someone leaving voice. */
export function playLeaveSound(volume = 0.22) {
  playTone(520, 340, 0.18, volume);
}

/** Confirmation chime when you yourself connect to voice (two rising notes). */
export function playConnectedSound(volume = 0.3) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // First note
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, now); // C5
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(volume, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(g1);
    g1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Second note (higher)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659, now + 0.1); // E5
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, now);
    g2.gain.setValueAtTime(volume, now + 0.1);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.connect(g2);
    g2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.25);
  } catch {
    // Audio context unavailable
  }
}

/** Brief descending tone when you disconnect from voice. */
export function playDisconnectedSound(volume = 0.26) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, now); // C5
    osc.frequency.exponentialRampToValueAtTime(330, now + 0.2); // E4

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    // Audio context unavailable
  }
}
