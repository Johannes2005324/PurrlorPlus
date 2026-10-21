import { readAudioSettings } from '../voice/audioSettings';
import { playTone } from '../voice/voiceSounds';

/**
 * The in-tab message cues: a short rising blip when a message of yours is sent, and a softer
 * two-step blip when one that would notify you comes in. Pure Web Audio like voiceSounds.ts, so
 * they need no desktop notification permission, only the tab. Each can be muted in
 * Settings → Voice & Audio (per device, audioSettings.ts).
 */
export function playMessageSentSound() {
  if (!readAudioSettings().messageSentSound) return;
  playTone(620, 880, 0.08, 0.12);
}

export function playMessageReceivedSound() {
  if (!readAudioSettings().messageReceivedSound) return;
  playTone(880, 880, 0.07, 0.14);
  setTimeout(() => playTone(1175, 1175, 0.09, 0.12), 80);
}
