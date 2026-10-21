import { useSyncExternalStore } from 'react';
import type { AudioCaptureOptions } from 'livekit-client';

/**
 * How *you* want calls to sound on this device: which microphone and speakers, the browser's voice
 * processing, and everyone's volume. Per-device (localStorage, like push-to-talk), never a Matrix
 * setting: a laptop and a desktop have different hardware, and nobody else needs to know.
 * Settings → Voice & Audio edits it; ActiveVoiceCall applies it, live during a call too.
 */
export type AudioSettings = {
  /** '' is "whatever the system's default is", which follows Windows when you plug in a headset. */
  inputDeviceId: string;
  outputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** Everyone in the call, 0–1. Each person's own slider multiplies on top of it. */
  outputVolume: number;
  /** The soft blip when a message of yours goes out. */
  messageSentSound: boolean;
  /** The blip when a message that would notify you comes in, Notification permission or not. */
  messageReceivedSound: boolean;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  outputVolume: 1,
  messageSentSound: true,
  messageReceivedSound: true,
};

const STORAGE_KEY = 'nekous_audio_settings';

function load(): AudioSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AudioSettings> | null;
    if (!stored || typeof stored !== 'object') return DEFAULT_AUDIO_SETTINGS;
    const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
    const volume = Number(stored.outputVolume);
    return {
      inputDeviceId: typeof stored.inputDeviceId === 'string' ? stored.inputDeviceId : '',
      outputDeviceId: typeof stored.outputDeviceId === 'string' ? stored.outputDeviceId : '',
      echoCancellation: bool(stored.echoCancellation, true),
      noiseSuppression: bool(stored.noiseSuppression, true),
      autoGainControl: bool(stored.autoGainControl, true),
      outputVolume: Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 1,
      messageSentSound: bool(stored.messageSentSound, true),
      messageReceivedSound: bool(stored.messageReceivedSound, true),
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

let current: AudioSettings | null = null;
const listeners = new Set<() => void>();

export function readAudioSettings(): AudioSettings {
  current ??= load();
  return current;
}

export function saveAudioSettings(changes: Partial<AudioSettings>): void {
  current = { ...readAudioSettings(), ...changes };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not remembered this time; it still applies now.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribe, readAudioSettings);
}

/** The microphone as LiveKit (and getUserMedia) should open it. */
export function audioCaptureOptions(s: AudioSettings): AudioCaptureOptions {
  return {
    ...(s.inputDeviceId && { deviceId: s.inputDeviceId }),
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
  };
}

/** What switchActiveDevice and setSinkId take for "the system default". */
export function deviceIdOrDefault(id: string): string {
  return id || 'default';
}
