import { TrackSource, type ParticipantInfo } from 'livekit-server-sdk';

type ParticipantLike = Pick<ParticipantInfo, 'identity' | 'tracks' | 'attributes'> & {
  joinedAt: bigint | number;
  joinedAtMs?: bigint | number;
};

export type VoiceParticipant = {
  identity: string;
  micMuted: boolean;
  deafened: boolean;
  joinedAt: number;
  /** Whether they are sharing their screen right now (a track with the screen-share source). */
  screenSharing: boolean;
};

/** The slice of a LiveKit participant that the channel list and Home page need. */
export function toVoiceParticipant(p: ParticipantLike): VoiceParticipant {
  const micTrack = p.tracks.find((t) => t.source === TrackSource.MICROPHONE);
  return {
    identity: p.identity,
    micMuted: micTrack?.muted ?? true,
    // Broadcast by the client itself via localParticipant.setAttributes — LiveKit has
    // no built-in "deafened" concept (muting your own playback of others isn't
    // something the server can see), see VoiceChannelPanel.tsx's toggleDeafen.
    deafened: p.attributes.deafened === 'true',
    // So the channel list can show people in the order they joined; LiveKit's own order isn't fixed.
    joinedAt: Number(p.joinedAtMs) || Number(p.joinedAt) * 1000,
    screenSharing: p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE),
  };
}
