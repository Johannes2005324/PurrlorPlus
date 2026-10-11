import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type Participant } from 'livekit-client';
import { liveCallAtom, type CallPerson } from './callPresence';

const UPDATES = [
  RoomEvent.Connected,
  RoomEvent.Reconnected,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ParticipantAttributesChanged,
] as const;

function person(p: Participant): CallPerson {
  return {
    identity: p.identity,
    joinedAt: p.joinedAt?.getTime(),
    micMuted: !p.isMicrophoneEnabled,
    deafened: p.attributes.deafened === 'true',
    speaking: p.isSpeaking,
  };
}

/**
 * Hands the call's live state to the rest of the app (liveCallAtom): who's in it, muted or
 * deafened, and talking. Renders nothing; lives inside LiveKitRoom, and clears it when the call ends.
 */
export function CallPresenceBridge({ roomId }: { roomId: string }) {
  const room = useRoomContext();
  const setLiveCall = useSetAtom(liveCallAtom);

  useEffect(() => {
    const update = () => {
      const everyone = [room.localParticipant, ...room.remoteParticipants.values()];
      setLiveCall({ roomId, people: everyone.map(person) });
    };
    update();
    for (const event of UPDATES) room.on(event, update);
    return () => {
      for (const event of UPDATES) room.off(event, update);
      setLiveCall(null);
    };
  }, [room, roomId, setLiveCall]);

  return null;
}
