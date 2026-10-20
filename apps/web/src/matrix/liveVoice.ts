import type { CallPerson } from '../features/voice/callPresence';
import { byJoinOrder } from '../features/voice/callPresence';
import type { VoiceChannelParticipant } from './hooks/useVoiceChannelParticipants';
import type { VoiceServerConfig } from './voice';

/** A voice channel in one of your Spaces, before anyone is known to be in it. */
export type VoiceChannelRef = {
  roomId: string;
  name: string;
  spaceId: string;
  spaceName: string;
  server: VoiceServerConfig;
};

/** A voice channel with people in it right now (Home's "Live now"). */
export type LiveVoiceChannel = VoiceChannelRef & {
  /** In the order they joined. */
  participants: VoiceChannelParticipant[];
  screenSharing: boolean;
};

/** The participants endpoint of the token server a voice server config points at. */
export function participantsUrl(server: VoiceServerConfig): string {
  return `${new URL(server.tokenEndpoint).origin}/api/livekit/rooms/participants`;
}

/**
 * One request per token server: channels grouped by the endpoint that answers for them, since a
 * server's batch endpoint takes many room IDs. Channels without a usable server config are skipped.
 */
export function groupByVoiceServer(channels: VoiceChannelRef[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const channel of channels) {
    let url: string;
    try {
      url = participantsUrl(channel.server);
    } catch {
      continue;
    }
    const ids = groups.get(url) ?? [];
    if (!ids.includes(channel.roomId)) ids.push(channel.roomId);
    groups.set(url, ids);
  }
  return groups;
}

/**
 * Which channels are live, from what each server answered (`polled`, by room ID) and the call
 * you're in (`liveCall`, which keeps up better than the poll). Empty channels are left out; the
 * busiest come first, then by Space and channel name.
 */
export function buildLiveChannels(
  channels: VoiceChannelRef[],
  polled: Record<string, VoiceChannelParticipant[]>,
  liveCall: { roomId: string; people: CallPerson[] } | null
): LiveVoiceChannel[] {
  const live: LiveVoiceChannel[] = [];
  for (const channel of channels) {
    let participants: VoiceChannelParticipant[] = polled[channel.roomId] ?? [];
    if (liveCall?.roomId === channel.roomId) {
      const sharing = new Map(participants.map((p) => [p.identity, p.screenSharing]));
      participants = liveCall.people.map((p) => ({
        identity: p.identity,
        micMuted: p.micMuted,
        deafened: p.deafened,
        joinedAt: p.joinedAt,
        screenSharing: sharing.get(p.identity),
      }));
    }
    if (participants.length === 0) continue;
    const ordered = byJoinOrder(participants);
    live.push({ ...channel, participants: ordered, screenSharing: ordered.some((p) => p.screenSharing) });
  }
  return live.sort(
    (a, b) =>
      b.participants.length - a.participants.length || a.spaceName.localeCompare(b.spaceName) || a.name.localeCompare(b.name)
  );
}
