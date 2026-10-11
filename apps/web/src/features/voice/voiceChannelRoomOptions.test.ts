import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalParticipant } from 'livekit-client';
import {
  APP_AUDIO_HINTS,
  readIncludeSystemAudio,
  saveIncludeSystemAudio,
  SCREEN_SHARE_CODEC,
  screenShareCaptureOptions,
  startScreenShare,
  voiceChannelRoomOptions,
  withDisplayMediaHints,
} from './voiceChannelRoomOptions';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('what a screen share publishes', () => {
  it('uses H.264, which GPUs encode and decode, at up to 60 fps and 8 Mbps', () => {
    expect(SCREEN_SHARE_CODEC).toBe('h264');
    expect(voiceChannelRoomOptions.publishDefaults?.videoCodec).toBe('h264');
    expect(voiceChannelRoomOptions.publishDefaults?.screenShareEncoding).toMatchObject({ maxBitrate: 8_000_000, maxFramerate: 60 });
  });
});

describe('what a screen share captures', () => {
  it('asks for 1080p at 60 fps (LiveKit would otherwise ask for 30) and for motion over sharpness', () => {
    for (const includeSystemAudio of [false, true]) {
      const options = screenShareCaptureOptions(includeSystemAudio);
      expect(options.resolution).toEqual({ width: 1920, height: 1080, frameRate: 60 });
      expect(options.contentHint).toBe('motion');
      expect(options.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true });
    }
  });

  it('never offers the computer’s sound by default, whatever is shared', () => {
    const options = screenShareCaptureOptions(false);
    expect(options.systemAudio).toBe('exclude');
    expect(options.video).toBeUndefined();
  });

  it('offers it once the sharer asks for it', () => {
    expect(screenShareCaptureOptions(true).systemAudio).toBe('include');
  });
});

describe('withDisplayMediaHints', () => {
  const fakeDevices = () => {
    const calls: unknown[] = [];
    const getDisplayMedia = vi.fn(async (constraints?: unknown) => {
      calls.push(constraints);
      return {} as MediaStream;
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
    return { calls, getDisplayMedia };
  };

  it('adds the hints to a capture request made while it runs, and puts the real function back', async () => {
    const { calls, getDisplayMedia } = fakeDevices();
    await withDisplayMediaHints(APP_AUDIO_HINTS, () => navigator.mediaDevices.getDisplayMedia({ video: true, systemAudio: 'exclude' } as DisplayMediaStreamOptions));
    expect(calls).toEqual([{ video: true, systemAudio: 'exclude', windowAudio: 'window' }]);
    expect(navigator.mediaDevices.getDisplayMedia).toBe(getDisplayMedia);
  });

  it('puts it back when the share fails or the picker is cancelled', async () => {
    const { getDisplayMedia } = fakeDevices();
    await expect(
      withDisplayMediaHints({ windowAudio: 'window' }, async () => {
        throw new Error('NotAllowedError');
      })
    ).rejects.toThrow('NotAllowedError');
    expect(navigator.mediaDevices.getDisplayMedia).toBe(getDisplayMedia);
  });

  it('just runs when the browser has no screen capture', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    await expect(withDisplayMediaHints({}, async () => 'ran')).resolves.toBe('ran');
  });
});

describe('startScreenShare', () => {
  const participant = () => {
    const setScreenShareEnabled = vi.fn(async () => undefined);
    return { setScreenShareEnabled, participant: { setScreenShareEnabled } as unknown as LocalParticipant };
  };

  it('starts a share with the capture options', async () => {
    const { setScreenShareEnabled, participant: p } = participant();
    await startScreenShare(p, true);
    expect(setScreenShareEnabled).toHaveBeenCalledWith(true, screenShareCaptureOptions(true));
  });

  it('asks the browser for a shared window’s own sound by default', async () => {
    const seen: unknown[] = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getDisplayMedia: async (constraints: unknown) => {
          seen.push(constraints);
          return {} as MediaStream;
        },
      },
      configurable: true,
    });
    const p = {
      setScreenShareEnabled: async () => {
        await navigator.mediaDevices.getDisplayMedia({ systemAudio: 'exclude' } as DisplayMediaStreamOptions);
      },
    } as unknown as LocalParticipant;
    await startScreenShare(p, false);
    expect(seen).toEqual([{ systemAudio: 'exclude', windowAudio: 'window' }]);
  });
});

describe('the computer’s-sound setting', () => {
  it('is off until chosen, then remembered', () => {
    expect(readIncludeSystemAudio()).toBe(false);
    saveIncludeSystemAudio(true);
    expect(readIncludeSystemAudio()).toBe(true);
    saveIncludeSystemAudio(false);
    expect(readIncludeSystemAudio()).toBe(false);
  });

  it('starts off for someone who had turned the old window-only option off', () => {
    localStorage.setItem('nekous_screen_share_app_audio_only', 'false');
    expect(readIncludeSystemAudio()).toBe(false);
  });
});
