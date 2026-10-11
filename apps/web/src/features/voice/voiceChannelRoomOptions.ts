/**
 * Shared LiveKit RoomOptions for voice/screen-share so the same codec and encoding
 * are used for the host and all viewers. H.264 for GPU-friendly decode on streamer
 * and viewer.
 *
 * Server has no GPU and does NOT transcode — it only forwards RTP. So no GPU
 * is needed on the server. Server CPU does packet crypto; high bitrate = more
 * packets. If your server is weak, set SERVER_MAX_BITRATE_CAP to limit load.
 *
 * Ported verbatim from cinny-voice.
 */
import type { AudioCaptureOptions, LocalParticipant, Room, RoomOptions, ScreenShareCaptureOptions } from 'livekit-client';

export const SCREEN_SHARE_CODEC = 'h264' as const;

/** Passed as `{ audio: SCREEN_SHARE_AUDIO_OPTIONS }` to `setScreenShareEnabled` — without an
 *  `audio` key at all, Chrome's own getDisplayMedia picker never even shows its "Share audio"
 *  checkbox, so screen shares could never include system/tab audio no matter what the user
 *  wanted (the actual bug this fixes). Echo cancellation/noise suppression/auto-gain are mic-
 *  input processing, not appropriate for system audio (music, game sound) — explicitly off so
 *  shared audio doesn't get run through voice-call DSP built for a microphone. The browser's own
 *  picker still lets the user leave the checkbox unticked per-share; this only makes the option
 *  exist at all.
 *
 *  `restrictOwnAudio` keeps Purrlor's own sound out of what's shared. Without it, a share that
 *  carries the computer's sound (and a window's, which on Windows is the computer's) also
 *  carried the call itself: everyone heard each other back through the share, and the share's
 *  sound was mixed with the voices. The browser takes out what this page plays (the call, music,
 *  notification sounds) and keeps the rest; one that can't ignores it (Chrome has it, Firefox
 *  and Safari not yet). */
export const SCREEN_SHARE_AUDIO_OPTIONS: AudioCaptureOptions = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  // Not in LiveKit's type yet; it passes the audio options to getDisplayMedia as they are.
  ...({ restrictOwnAudio: true } as object),
};

/**
 * What the browser is asked to capture. LiveKit's own default is 1080p at 30 fps, which capped every
 * share at 30 fps however high the encoder below was allowed to go; this asks for 60. The
 * `motion` content hint tells the encoder to hold the frame rate when the connection or the CPU
 * is short, and give up sharpness first (the browser's default for a screen is the other way
 * round: it keeps text crisp and drops frames, which looks like a slideshow in a game or video).
 */
export const SCREEN_SHARE_CAPTURE: ScreenShareCaptureOptions = {
  audio: SCREEN_SHARE_AUDIO_OPTIONS,
  resolution: { width: 1920, height: 1080, frameRate: 60 },
  contentHint: 'motion',
};

/**
 * The options for one share. By default a share never carries the whole computer's sound: system
 * audio is not offered (`systemAudio: 'exclude'`), a tab shares its own sound, and for a window
 * the browser is asked for that window's sound only (see APP_AUDIO_HINTS). Where a browser can't
 * capture one window's audio, a window share has none: it never falls back to everything.
 *
 * It used to be the other way round, with window-only sound an option you had to find: Chrome's
 * sound for a shared window *is* the system's ("Also share system audio"), so sharing a window
 * sent every sound on the computer, notifications and other calls included, to everyone in the
 * call. `includeSystemAudio` (the "Share my computer's sound too" option) is now the opt-in.
 */
export function screenShareCaptureOptions(includeSystemAudio: boolean): ScreenShareCaptureOptions {
  return { ...SCREEN_SHARE_CAPTURE, systemAudio: includeSystemAudio ? 'include' : 'exclude' };
}

/** LiveKit doesn't pass this newer getDisplayMedia option on, so withDisplayMediaHints adds it. */
export const APP_AUDIO_HINTS = { windowAudio: 'window' } as const;

/**
 * Runs `run` with extra options merged into every `navigator.mediaDevices.getDisplayMedia` call it
 * makes, then puts the real function back (also when `run` fails or the person cancels the picker).
 * For options the browser knows but LiveKit's capture options have no field for.
 */
export async function withDisplayMediaHints<T>(hints: object, run: () => Promise<T>): Promise<T> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!devices?.getDisplayMedia) return run();
  const original = devices.getDisplayMedia;
  devices.getDisplayMedia = function (this: MediaDevices, constraints?: DisplayMediaStreamOptions) {
    return original.call(devices, { ...constraints, ...hints } as DisplayMediaStreamOptions);
  };
  try {
    return await run();
  } finally {
    devices.getDisplayMedia = original;
  }
}

/** Starts a screen share with the capture options above. */
export function startScreenShare(participant: LocalParticipant, includeSystemAudio: boolean): Promise<unknown> {
  const run = () => participant.setScreenShareEnabled(true, screenShareCaptureOptions(includeSystemAudio));
  return includeSystemAudio ? run() : withDisplayMediaHints(APP_AUDIO_HINTS, run);
}

// A new key, not the old 'nekous_screen_share_app_audio_only' inverted: everyone starts on the safe
// default, including those who never found the old option.
const SYSTEM_AUDIO_KEY = 'purrlor_screen_share_system_audio';

/** Whether shares may carry the whole computer's sound (remembered per browser; off until chosen). */
export function readIncludeSystemAudio(): boolean {
  try {
    return localStorage.getItem(SYSTEM_AUDIO_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveIncludeSystemAudio(on: boolean): void {
  try {
    localStorage.setItem(SYSTEM_AUDIO_KEY, String(on));
  } catch {
    // Not remembered this time; it still applies now.
  }
}

/** Optional cap (bps) so a weak server (no GPU, limited CPU) isn't overloaded by packet crypto. Undefined = no cap. */
export const SERVER_MAX_BITRATE_CAP: number | undefined = undefined; // e.g. 20_000_000 if server is the bottleneck

export const voiceChannelRoomOptions: RoomOptions = {
  publishDefaults: {
    videoCodec: SCREEN_SHARE_CODEC,
    screenShareEncoding: {
      maxBitrate: 8_000_000, // 8 Mbps baseline for 1080p@60 – encoder needs headroom to hit 60fps
      maxFramerate: 60,
      priority: 'high', // CPU/bandwidth priority in Chrome's congestion controller
      ...({ networkPriority: 'high' } as object), // DSCP packet scheduling priority (not in LiveKit type but passed to RTCRtpSendParameters)
    } as import('livekit-client').VideoEncoding,
  },
};

/** Jitter buffer target (ms) for screen share on the viewer. Keep small – a huge buffer queues frames and can cause the renderer to drop or stutter. */
export const SCREEN_SHARE_JITTER_BUFFER_TARGET_MS = 50;

/**
 * Set a larger jitter buffer target on the receiver for the given track so the viewer
 * buffers more before playing – reduces frame drops, adds delay. Optionally attach a
 * receiver transform that periodically requests keyframes (PLI); pass keyframeRequestPort
 * so the main thread can send { keyframeIntervalMs } to adapt to decoder load.
 * Returns the receiver so the caller can poll getStats() for dynamic adaptation.
 *
 * `Room.engine`'s subscriber peer connection has no direct `getReceivers()` in this LiveKit
 * version (cinny-voice's copy of this function targeted an older one that had it) — go through
 * `pcManager.subscriber.getTransceivers()` and read `.receiver` off each instead, which is the
 * same underlying RTCRtpReceiver set.
 */
export function setScreenShareJitterBufferTarget(
  room: Room,
  mediaStreamTrack: MediaStreamTrack | undefined,
  options?: { keyframeRequestWorker?: Worker; keyframeRequestPort?: MessagePort }
): RTCRtpReceiver | undefined {
  if (!mediaStreamTrack?.id) return undefined;
  try {
    const transceivers = room.engine?.pcManager?.subscriber?.getTransceivers?.() ?? [];
    const receiver = transceivers.map((t) => t.receiver).find((r) => r.track?.id === mediaStreamTrack.id);
    if (!receiver) return undefined;
    if ('jitterBufferTarget' in receiver) {
      (receiver as RTCRtpReceiver & { jitterBufferTarget: number }).jitterBufferTarget =
        SCREEN_SHARE_JITTER_BUFFER_TARGET_MS;
    }
    const worker = options?.keyframeRequestWorker;
    const port = options?.keyframeRequestPort;
    const RTCTransform =
      typeof globalThis !== 'undefined' &&
      (
        globalThis as unknown as {
          RTCRtpScriptTransform?: new (w: Worker, o?: object, t?: Transferable[]) => RTCRtpScriptTransform;
        }
      ).RTCRtpScriptTransform;
    if (worker && RTCTransform && 'transform' in receiver) {
      try {
        const transformOptions = port ? { port } : {};
        const transfer = port ? [port] : [];
        (receiver as RTCRtpReceiver & { transform?: unknown }).transform = new RTCTransform(
          worker,
          transformOptions,
          transfer
        );
      } catch {
        // ignore
      }
    }
    return receiver;
  } catch {
    return undefined;
  }
}

/**
 * Validate that the browser supports H.264 for receiving/decoding video (so screen
 * share from others uses hardware decode when possible). Logs a warning if not.
 * Call once when the voice room is used (e.g. on connect or before screen share).
 */
export function validateScreenShareCodecSupport(): void {
  if (typeof RTCRtpReceiver === 'undefined' || !RTCRtpReceiver.getCapabilities) return;
  try {
    const caps = RTCRtpReceiver.getCapabilities('video');
    const codecs = caps?.codecs ?? [];
    const hasH264 = codecs.some(
      (c) => c.mimeType?.toLowerCase() === 'video/h264' || c.mimeType?.toLowerCase() === 'video/avc'
    );
    if (!hasH264) {
      console.warn(
        '[voice] H.264 is not in the browser’s supported receive codecs. Screen share may fall back to VP8 (software decode, lower FPS).'
      );
    }
  } catch {
    // ignore
  }
}
