import { Track, type RemoteParticipant, type Room } from 'livekit-client';
import { readAudioSettings } from './audioSettings';
import { readShareVolume, saveShareVolume } from './listenVolume';

/**
 * What each person in the call plays at: their own "volume for me" slider times your overall
 * volume (Settings → Voice & Audio). Both go through RemoteParticipant.setVolume, so they have to
 * be combined here; setting either one directly would undo the other. The per-person levels last
 * for this page load, by participant identity.
 */
const personal = new Map<string, number>();

export function personVolume(identity: string): number {
  return personal.get(identity) ?? 1;
}

export function setPersonVolume(participant: RemoteParticipant, volume: number): void {
  personal.set(participant.identity, volume);
  participant.setVolume(volume * readAudioSettings().outputVolume);
}

/** Your volume for the sound of screen shares (anyone's), times your overall volume; remembered. */
export function setShareVolume(room: Room, volume: number): void {
  saveShareVolume(volume);
  applyCallVolumes(room);
}

/** Re-applies every remote participant's levels, voice and screen share sound: after the overall
 *  volume changes, or someone joins. LiveKit keeps a level per source, applied as tracks arrive. */
export function applyCallVolumes(room: Room): void {
  const overall = readAudioSettings().outputVolume;
  const share = readShareVolume() * overall;
  for (const participant of room.remoteParticipants.values()) {
    participant.setVolume(personVolume(participant.identity) * overall);
    participant.setVolume(share, Track.Source.ScreenShareAudio);
  }
}
