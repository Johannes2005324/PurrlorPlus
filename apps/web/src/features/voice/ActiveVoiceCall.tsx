import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { RoomEvent, type Room as MatrixRoom } from 'matrix-js-sdk';
import { activeVoiceChannelIdAtom } from '../../app/state/selection';
import { useVoiceConnection } from '../../matrix/hooks/useVoiceConnection';
import { VoiceCallContext, type VoiceCallContextValue } from './voiceCallContext';
import { playConnectedSound, playDisconnectedSound, warmUpAudioContext } from './voiceSounds';
import { validateScreenShareCodecSupport, voiceChannelRoomOptions } from './voiceChannelRoomOptions';
import { ScreenShareProvider } from './ScreenShareProvider';
import { WatchTogetherProvider } from './WatchTogetherProvider';
import { ApplyAudioSettings } from './ApplyAudioSettings';
import { CallHotkeys } from './CallHotkeys';
import { CallPresenceBridge } from './CallPresenceBridge';
import { audioCaptureOptions, deviceIdOrDefault, readAudioSettings } from './audioSettings';

// Split out of VoiceCallSession.tsx so @livekit/components-react (and livekit-client underneath
// it) load as their own chunk — via React.lazy, see VoiceCallSession.tsx — only once there's
// actually a voice channel selected, instead of shipping in the main bundle for every visitor.

/** Owns the actual LiveKit connection for whichever room VoiceCallSession says is active. */
export default function ActiveVoiceCall({ room, children }: { room: MatrixRoom; children: ReactNode }) {
  const setActiveVoiceChannelId = useSetAtom(activeVoiceChannelIdAtom);
  const { state, voiceServer, connect, disconnect } = useVoiceConnection(room);
  const [deafened, setDeafened] = useState(false);
  const autoConnectedKeyRef = useRef<string | null>(null);
  // The devices and voice processing the call opens with. Frozen for the call's lifetime:
  // LiveKitRoom makes a new Room (dropping the call) whenever `options` changes, so changes made
  // during the call go through ApplyAudioSettings instead.
  const [roomOptions] = useState(() => {
    const s = readAudioSettings();
    return {
      ...voiceChannelRoomOptions,
      audioCaptureDefaults: audioCaptureOptions(s),
      audioOutput: { deviceId: deviceIdOrDefault(s.outputDeviceId) },
    };
  });

  // Auto-join whenever the active room actually changes — selecting a voice channel (or
  // switching from one to another) is the join action now, there's no separate button for it.
  //
  // Keyed on the voice server too, not just the room: the Space's config is read out of room
  // state, which on a cold sync can still be loading when the channel is first selected. Keying
  // on the room alone meant that one-shot attempt happened while there was nothing to connect
  // to, and the call sat on "No voice server is configured" forever even once it had loaded.
  useEffect(() => {
    if (!voiceServer) return;
    const key = `${room.roomId}|${voiceServer.tokenEndpoint}`;
    if (autoConnectedKeyRef.current === key) return;
    autoConnectedKeyRef.current = key;
    warmUpAudioContext();
    validateScreenShareCodecSupport();
    connect();
  }, [room.roomId, voiceServer, connect]);

  const leave = useCallback(() => {
    disconnect();
    setActiveVoiceChannelId(null);
  }, [disconnect, setActiveVoiceChannelId]);

  // Leaving the channel's room (leaving its Space, being kicked or banned) ends the call. The
  // LiveKit token was issued while you were a member, so nothing else would hang up for you.
  useEffect(() => {
    const onMembership = (_room: MatrixRoom, membership: string) => {
      if (membership !== 'join') leave();
    };
    room.on(RoomEvent.MyMembership, onMembership);
    return () => {
      room.removeListener(RoomEvent.MyMembership, onMembership);
    };
  }, [room, leave]);

  const retry = useCallback(() => {
    void connect();
  }, [connect]);

  const ctxValue = useMemo<VoiceCallContextValue>(
    () => ({ roomId: room.roomId, state, deafened, setDeafened, leave, retry }),
    [room.roomId, state, deafened, leave, retry]
  );

  if (state.status !== 'ready') {
    return <VoiceCallContext.Provider value={ctxValue}>{children}</VoiceCallContext.Provider>;
  }

  return (
    <LiveKitRoom
      serverUrl={state.serverUrl}
      token={state.token}
      connect
      audio
      options={roomOptions}
      onConnected={() => playConnectedSound()}
      onDisconnected={() => {
        playDisconnectedSound();
        leave();
      }}
      style={{ display: 'contents' }}
      data-nu-role="voice-session"
    >
      <RoomAudioRenderer muted={deafened} />
      <ApplyAudioSettings />
      <CallPresenceBridge roomId={room.roomId} />
      <VoiceCallContext.Provider value={ctxValue}>
        <CallHotkeys />
        <WatchTogetherProvider>
          <ScreenShareProvider>{children}</ScreenShareProvider>
        </WatchTogetherProvider>
      </VoiceCallContext.Provider>
    </LiveKitRoom>
  );
}
