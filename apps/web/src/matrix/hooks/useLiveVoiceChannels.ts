import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { liveCallAtom } from '../../features/voice/callPresence';
import { useMatrixClient } from '../MatrixClientContext';
import { readChannelType } from '../channelType';
import { buildLiveChannels, groupByVoiceServer, type LiveVoiceChannel, type VoiceChannelRef } from '../liveVoice';
import { getOpenIdTokenCached } from '../openIdToken';
import { readVoiceServerConfig } from '../voice';
import { listChildRooms } from './useSpaceRooms';
import { useSpaces } from './useSpaces';
import type { VoiceChannelParticipant } from './useVoiceChannelParticipants';

const POLL_INTERVAL_MS = 10_000;

/**
 * Voice channels across your joined Spaces that have people in them right now. One batched
 * request per voice server every ~10 seconds (the token server's participants endpoint takes many
 * room IDs), and only while `active` and the page is visible. The call you're in is merged in
 * from liveCallAtom.
 */
export function useLiveVoiceChannels(active: boolean): LiveVoiceChannel[] {
  const mx = useMatrixClient();
  const spaces = useSpaces();
  const liveCall = useAtomValue(liveCallAtom);
  const [state, setState] = useState<{ channels: VoiceChannelRef[]; polled: Record<string, VoiceChannelParticipant[]> }>({
    channels: [],
    polled: {},
  });
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;
  const spaceKey = spaces.map((space) => space.roomId).join('\n');

  const poll = useCallback(async (): Promise<{ channels: VoiceChannelRef[]; polled: Record<string, VoiceChannelParticipant[]> }> => {
    const channels: VoiceChannelRef[] = [];
    for (const space of spacesRef.current) {
      const server = readVoiceServerConfig(mx, space);
      if (!server) continue;
      for (const room of listChildRooms(mx, space.roomId)) {
        if (readChannelType(room) === 'voice') {
          channels.push({ roomId: room.roomId, name: room.name, spaceId: space.roomId, spaceName: space.name, server });
        }
      }
    }
    const polled: Record<string, VoiceChannelParticipant[]> = {};
    const groups = groupByVoiceServer(channels);
    if (groups.size > 0) {
      const openIdToken = await getOpenIdTokenCached(mx);
      await Promise.all(
        [...groups].map(async ([url, roomIds]) => {
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ openid_token: openIdToken, room_ids: roomIds }),
            });
            if (!res.ok) return;
            Object.assign(polled, (await res.json()) as Record<string, VoiceChannelParticipant[]>);
          } catch {
            // A server that doesn't answer just shows nothing live.
          }
        })
      );
    }
    return { channels, polled };
  }, [mx]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      poll()
        .then((next) => {
          if (!cancelled) setState(next);
        })
        .catch(() => {});
    };
    const start = () => {
      if (timer || document.hidden) return;
      tick();
      timer = setInterval(tick, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, poll, spaceKey]);

  return useMemo(
    () => buildLiveChannels(state.channels, state.polled, liveCall),
    [state, liveCall]
  );
}

