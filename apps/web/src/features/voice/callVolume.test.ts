import { Track, type Room } from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCallVolumes, setShareVolume } from './callVolume';
import { readListenVolume, readShareVolume, readWatchVolume, saveWatchVolume } from './listenVolume';

function fakeRoom() {
  const setVolume = vi.fn();
  const room = { remoteParticipants: new Map([['@a:s', { identity: '@a:s', setVolume }]]) } as unknown as Room;
  return { room, setVolume };
}

describe('volumes for me', () => {
  beforeEach(() => localStorage.clear());

  it('starts music at 0.6 and video and screen shares at full, each remembered on its own', () => {
    expect([readListenVolume(), readWatchVolume(), readShareVolume()]).toEqual([0.6, 1, 1]);
    saveWatchVolume(0.3);
    expect([readListenVolume(), readWatchVolume(), readShareVolume()]).toEqual([0.6, 0.3, 1]);
  });

  it("sets a screen share's sound apart from the sharer's voice, and remembers it", () => {
    const { room, setVolume } = fakeRoom();
    setShareVolume(room, 0.25);
    expect(readShareVolume()).toBe(0.25);
    expect(setVolume).toHaveBeenCalledWith(0.25, Track.Source.ScreenShareAudio);
    // The voice stays where it was.
    expect(setVolume.mock.calls.filter(([, source]) => source === undefined)).toEqual([[1]]);
  });

  it('applies the screen share level to everyone, as they join', () => {
    localStorage.setItem('nekous_screen_share_volume', '0.5');
    const { room, setVolume } = fakeRoom();
    applyCallVolumes(room);
    expect(setVolume).toHaveBeenCalledWith(0.5, Track.Source.ScreenShareAudio);
  });
});
