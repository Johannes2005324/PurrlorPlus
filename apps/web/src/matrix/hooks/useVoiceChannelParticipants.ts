import { useEffect, useState } from 'react';
import { useMatrixClient } from '../MatrixClientContext';
import { getOpenIdTokenCached } from '../openIdToken';
import type { VoiceServerConfig } from '../voice';

const POLL_INTERVAL_MS = 5000;

export type VoiceChannelParticipant = {
  /** Matrix user ID (LiveKit identities are Matrix user IDs — see services/token-server). */
  identity: string;
  micMuted: boolean;
  /** Broadcast via the participant's own LiveKit attributes — see
   *  VoiceChannelPanel.tsx's toggleDeafen; there's no server-side signal for this. */
  deafened: boolean;
  /** When they joined, in ms; absent from a token server older than this field. */
  joinedAt?: number;
  /** Whether they're sharing their screen; absent from a token server older than this field. */
  screenSharing?: boolean;
};

/**
 * Polls services/token-server's `POST /api/livekit/rooms/participants` — queried live from
 * LiveKit itself on each call (see docs/voice-architecture.md's "LiveKit room lifecycle"), so
 * it reflects current membership and mic/deafen state, not a point-in-time snapshot. Returns
 * raw identities, not resolved to a display name/avatar — the caller has the room membership
 * for that.
 *
 * Authenticated with a Matrix OpenID token (reused until near expiry, openIdToken.ts), and the
 * token server only answers for channels you're a member of — so who's in a call isn't visible
 * to anyone who merely knows the room ID.
 */
export function useVoiceChannelParticipants(
  roomId: string,
  voiceServer: VoiceServerConfig | undefined
): VoiceChannelParticipant[] {
  const mx = useMatrixClient();
  const [participants, setParticipants] = useState<VoiceChannelParticipant[]>([]);

  useEffect(() => {
    if (!voiceServer) {
      setParticipants([]);
      return undefined;
    }

    let cancelled = false;
    const origin = new URL(voiceServer.tokenEndpoint).origin;
    const url = `${origin}/api/livekit/rooms/participants`;

    const poll = async () => {
      try {
        const openIdToken = await getOpenIdTokenCached(mx);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openid_token: openIdToken, room_ids: [roomId] }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Record<string, VoiceChannelParticipant[]>;
        if (!cancelled) setParticipants(data[roomId] ?? []);
      } catch {
        // Transient network errors just leave the last-known list showing.
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mx, roomId, voiceServer]);

  return participants;
}
