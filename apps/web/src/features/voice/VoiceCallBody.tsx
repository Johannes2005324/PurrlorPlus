import { useEffect, useRef, useState } from 'react';
import { ConnectionQuality, Track, type Participant, type RemoteParticipant } from 'livekit-client';
import {
  isTrackReference,
  useConnectionQualityIndicator,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
  type TrackReference,
} from '@livekit/components-react';
import type { Room as MatrixRoom } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { Menu, MenuItem } from '../../components/Menu';
import { useVoiceCall } from './voiceCallContext';
import { useParticipantSounds } from './useParticipantSounds';
import { usePushToTalk } from './usePushToTalk';
import { personVolume, setPersonVolume } from './callVolume';
import { toggleDeafen, toggleMute } from './callActions';
import { readIncludeSystemAudio, saveIncludeSystemAudio, setScreenShareJitterBufferTarget, startScreenShare } from './voiceChannelRoomOptions';
import { useCallScreenShare } from './ScreenShareProvider';
import { byJoinOrder } from './callPresence';
import { useSharedWatchTogether } from './watchTogetherContext';
import { sessionMode, type WatchTogetherMode } from './watchTogether';
import { WatchTogetherModal } from './WatchTogetherModal';
import { WatchTogetherPlayer } from './WatchTogetherPlayer';
import { WatchPartyStartBanner } from './WatchPartyStartBanner';
import '@livekit/components-styles';

// Split out of VoiceChannelPanel.tsx so livekit-client/@livekit/components-react — and everything
// they pull in — load as their own chunk (React.lazy, see VoiceChannelPanel.tsx) only once a call
// actually reaches the "ready" state, instead of shipping in the main bundle for every visitor.

/** LiveKit identities are Matrix user IDs (see services/token-server) — resolve back to a room member for avatar/display name. */
function participantDisplayName(room: MatrixRoom, p: Participant): string {
  return room.getMember(p.identity)?.name || p.name || p.identity;
}

function participantAvatarUrl(room: MatrixRoom, p: Participant): string | null {
  return room.getMember(p.identity)?.getMxcAvatarUrl() ?? null;
}

function connectionQualityBars(quality: ConnectionQuality): number {
  if (quality === ConnectionQuality.Excellent) return 3;
  if (quality === ConnectionQuality.Good) return 2;
  if (quality === ConnectionQuality.Poor) return 1;
  return 0; // Lost/Unknown
}

/** One participant tile — its own component (not inlined in a .map()) because
 *  useConnectionQualityIndicator is a hook and hooks can't run inside a loop callback; this is
 *  the per-item component React's rules require for that. Also owns the local-only "volume for
 *  me" slider (LiveKit's RemoteParticipant.setVolume — client-side only, doesn't affect what
 *  anyone else hears) and the connection-quality bars, both README-flagged as deferred. */
function ParticipantRow({
  room,
  participant,
  speaking,
  cameraTrack,
}: {
  room: MatrixRoom;
  participant: Participant;
  speaking: boolean;
  cameraTrack?: TrackReference;
}) {
  const { quality } = useConnectionQualityIndicator({ participant });
  const bars = connectionQualityBars(quality);
  const [volume, setVolume] = useState(() => personVolume(participant.identity));
  const name = participantDisplayName(room, participant);

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    setPersonVolume(participant as RemoteParticipant, value);
  };

  if (cameraTrack) {
    return (
      <li
        className={
          speaking
            ? 'nu-voice-participant nu-voice-participant--video nu-voice-participant--speaking'
            : 'nu-voice-participant nu-voice-participant--video'
        }
      >
        <div className="nu-voice-participant__video-tile" data-nu-role="voice-participant-video">
          <VideoTrack trackRef={cameraTrack} />
          <span className="nu-voice-participant__video-name">
            {name}
            {!participant.isMicrophoneEnabled && <span aria-label="Muted" title="Muted">🔇</span>}
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className={speaking ? 'nu-voice-participant nu-voice-participant--speaking' : 'nu-voice-participant'}>
      <span className="nu-voice-participant__avatar">
        {speaking && <span className="nu-voice-participant__ring" aria-hidden="true" />}
        <Avatar name={name} mxcUrl={participantAvatarUrl(room, participant)} size={48} />
      </span>
      <span className="nu-voice-participant__name">{name}</span>
      <span
        className="nu-voice-participant__quality"
        data-nu-role="voice-participant-quality"
        title={`Connection: ${quality}`}
      >
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={
              bar <= bars ? 'nu-voice-participant__quality-bar nu-voice-participant__quality-bar--filled' : 'nu-voice-participant__quality-bar'
            }
          />
        ))}
      </span>
      {!participant.isMicrophoneEnabled && (
        <span className="nu-voice-participant__muted" aria-label="Muted" title="Muted">
          🔇
        </span>
      )}
      {participant.attributes.deafened === 'true' && (
        <span className="nu-voice-participant__muted" aria-label="Deafened" title="Deafened">
          🔕
        </span>
      )}
      {!participant.isLocal && (
        <input
          type="range"
          className="nu-voice-participant__volume"
          data-nu-role="voice-participant-volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          title="Volume for me"
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
        />
      )}
    </li>
  );
}

/** One button in the call's control bar: an icon in a circle with what it does written under it.
 *  `off` is something of yours that's switched off (muted, deafened), `on` something you're
 *  sending (camera, screen). */
function CallControl({
  icon,
  label,
  title,
  state,
  role,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  title: string;
  state: 'normal' | 'on' | 'off' | 'leave';
  role: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={state === 'normal' ? 'nu-call-control' : `nu-call-control nu-call-control--${state}`}
      data-nu-role={role}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="nu-call-control__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="nu-call-control__label">{label}</span>
    </button>
  );
}

/** The live call UI — participant grid, controls, screen share/Watch Together slot — for a
 *  channel whose call has actually reached the "ready" (connected) state. Loaded lazily by
 *  VoiceChannelPanel via React.lazy, since everything here (and its LiveKit imports above) is
 *  only ever needed once a call is really connected. */
export default function VoiceCallBody({ room, onLeave }: { room: MatrixRoom; onLeave: () => void }) {
  useParticipantSounds();
  // Who joined first, first, for everyone in the call (callPresence.ts); LiveKit puts you first.
  const participants = byJoinOrder(useParticipants().map((p) => ({ identity: p.identity, joinedAt: p.joinedAt?.getTime(), p }))).map(({ p }) => p);
  const speaking = useSpeakingParticipants();
  const speakingIds = new Set(speaking.map((p) => p.identity));
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled, isCameraEnabled } = useLocalParticipant();
  const pushToTalk = usePushToTalk();
  // Held at call level (ScreenShareProvider): which share you're watching, and its pop-out window,
  // which stays open in other channels.
  const { shares: screenShares, active: activeScreenShare, select: selectScreenShare, popout: screenSharePopout } =
    useCallScreenShare();
  const cameraTracks = useTracks([Track.Source.Camera]).filter(isTrackReference);
  const cameraTrackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const call = useVoiceCall();
  const deafened = call?.deafened ?? false;
  const setDeafened = call?.setDeafened ?? (() => {});
  const livekitRoom = useRoomContext();
  const keyframeWorkerRef = useRef<Worker>();
  // Held at call level (VoiceCallSession), so it outlives this pane — Listen together keeps playing
  // from the Now playing card while you're in another channel.
  const watchTogether = useSharedWatchTogether();
  const sharedMode = watchTogether?.state ? sessionMode(watchTogether.state) : undefined;
  const [watchTogetherModal, setWatchTogetherModal] = useState<WatchTogetherMode | null>(null);
  // Off: a share carries only its tab's or window's own sound, never the whole computer's
  // (voiceChannelRoomOptions.ts).
  const [includeSystemAudio, setIncludeSystemAudio] = useState(readIncludeSystemAudio);

  // Viewer-side only: ask the remote sharer for keyframes periodically and give the decoder a
  // slightly larger jitter buffer, trading a little latency for fewer dropped/stuttered frames.
  useEffect(() => {
    if (!activeScreenShare || activeScreenShare.participant.isLocal) return;
    const mediaStreamTrack = activeScreenShare.publication.track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;
    if (!keyframeWorkerRef.current) {
      keyframeWorkerRef.current = new Worker(new URL('./screenShareKeyframeRequest.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    setScreenShareJitterBufferTarget(livekitRoom, mediaStreamTrack, {
      keyframeRequestWorker: keyframeWorkerRef.current,
    });
  }, [activeScreenShare, livekitRoom]);

  const onToggleDeafen = () => toggleDeafen(localParticipant, deafened, setDeafened);
  const onToggleMic = () => toggleMute(localParticipant, deafened, setDeafened);

  const micIcon = pushToTalk.enabled || isMicrophoneEnabled ? 'mic' : 'micOff';
  const micLabel = pushToTalk.rebinding
    ? 'Press a key'
    : pushToTalk.enabled
      ? `Hold ${pushToTalk.keyLabel}`
      : isMicrophoneEnabled
        ? 'Mute'
        : 'Unmute';
  const micTitle = pushToTalk.rebinding
    ? 'Press the key you want to hold to talk (Escape or click to cancel)'
    : pushToTalk.enabled
      ? `Push to talk is on: hold ${pushToTalk.keyLabel} to talk`
      : isMicrophoneEnabled
        ? 'Mute your microphone'
        : 'Unmute your microphone';

  return (
    <>
      {activeScreenShare ? (
        <div className="nu-voice-panel__screen-share" data-nu-role="voice-screen-share">
          {screenSharePopout.isOpen ? (
            <p className="nu-voice-panel__screen-share-popped-out">
              Popped out into its own window.
            </p>
          ) : activeScreenShare.publication.track ? (
            <VideoTrack trackRef={activeScreenShare} />
          ) : (
            // Just switched to: its stream is on its way (ScreenShareProvider subscribes to it).
            <p className="nu-voice-panel__screen-share-popped-out">Loading the share…</p>
          )}
          {screenShares.length > 1 && (
            // More than one person sharing: pick whose to watch. Yours is in the list too.
            <div className="nu-voice-panel__share-tabs" role="tablist" aria-label="Screen shares" data-nu-role="voice-screen-share-tabs">
              {screenShares.map((share) => (
                <button
                  key={share.participant.identity}
                  type="button"
                  role="tab"
                  aria-selected={share === activeScreenShare}
                  className={
                    share === activeScreenShare
                      ? 'nu-voice-panel__share-tab nu-voice-panel__share-tab--active'
                      : 'nu-voice-panel__share-tab'
                  }
                  data-nu-role="voice-screen-share-tab"
                  onClick={() => selectScreenShare(share.participant.identity)}
                >
                  {share.participant.isLocal ? 'Your screen' : participantDisplayName(room, share.participant)}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="nu-voice-panel__screen-share-popout"
            data-nu-role="voice-screen-share-popout"
            title={screenSharePopout.isOpen ? 'Bring back' : 'Pop out'}
            onClick={screenSharePopout.toggle}
          >
            {screenSharePopout.isOpen ? '⇱' : '⇲'}
          </button>
        </div>
      ) : (
        // Watch Together only ever shows up here when nobody's actually sharing their screen —
        // screen share always wins the slot if both happen to be active at once, but the watch
        // session itself keeps running in the background (see useWatchTogether.ts) and reappears
        // the moment the screen share stops, rather than being force-stopped by it.
        // Listen together plays from the Now playing card instead, so it has nothing here.
        watchTogether?.state &&
        sharedMode === 'watch' && <WatchTogetherPlayer state={watchTogether.state} controls={watchTogether} />
      )}
      <WatchPartyStartBanner room={room} />
      <ul className="nu-voice-participants" data-nu-role="voice-participants">
        {participants.map((p) => (
          <ParticipantRow
            key={p.identity}
            room={room}
            participant={p}
            speaking={speakingIds.has(p.identity)}
            cameraTrack={cameraTrackByIdentity.get(p.identity)}
          />
        ))}
      </ul>
      <div className="nu-voice-controls" data-nu-role="voice-controls">
        <div className="nu-call-control-group">
          <CallControl
            icon={micIcon}
            label={micLabel}
            state={!isMicrophoneEnabled && !pushToTalk.enabled ? 'off' : 'normal'}
            role="voice-mic-toggle"
            disabled={pushToTalk.enabled && !pushToTalk.rebinding}
            title={micTitle}
            onClick={pushToTalk.rebinding ? pushToTalk.cancelRebind : onToggleMic}
          />
          <Menu
            label="Microphone options"
            trigger={<Icon name="chevronUp" size={12} />}
            triggerClassName="nu-call-control__options"
            role="voice-mic-options"
            dropUp
          >
            <MenuItem icon={pushToTalk.enabled ? 'check' : undefined} role="voice-ptt-toggle" onSelect={() => pushToTalk.setEnabled(!pushToTalk.enabled)}>
              Push to talk
            </MenuItem>
            {pushToTalk.enabled && (
              <MenuItem icon="pencil" role="voice-ptt-rebind" onSelect={pushToTalk.startRebind}>
                Change key ({pushToTalk.keyLabel})
              </MenuItem>
            )}
          </Menu>
        </div>
        <CallControl
          icon={deafened ? 'headphonesOff' : 'headphones'}
          label={deafened ? 'Undeafen' : 'Deafen'}
          state={deafened ? 'off' : 'normal'}
          role="voice-deafen-toggle"
          title={deafened ? 'Hear everyone again' : 'Stop hearing everyone (also mutes you)'}
          onClick={onToggleDeafen}
        />
        <CallControl
          icon={isCameraEnabled ? 'camera' : 'cameraOff'}
          label={isCameraEnabled ? 'Stop video' : 'Camera'}
          state={isCameraEnabled ? 'on' : 'normal'}
          role="voice-camera-toggle"
          title={isCameraEnabled ? 'Turn off your camera' : 'Turn on your camera'}
          onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        />
        <div className="nu-call-control-group">
          <CallControl
            icon="monitor"
            label={isScreenShareEnabled ? 'Stop sharing' : 'Share'}
            state={isScreenShareEnabled ? 'on' : 'normal'}
            role="voice-screen-share-toggle"
            title={
              isScreenShareEnabled
                ? 'Stop sharing your screen'
                : includeSystemAudio
                  ? 'Share your screen or a window, with your computer’s sound'
                  : 'Share your screen or a window'
            }
            onClick={() => {
              // Closing the browser's picker rejects; that's not an error worth showing.
              const started = isScreenShareEnabled ? localParticipant.setScreenShareEnabled(false) : startScreenShare(localParticipant, includeSystemAudio);
              started.catch(() => undefined);
            }}
          />
          {!isScreenShareEnabled && (
            <Menu
              label="Screen share options"
              trigger={<Icon name="chevronUp" size={12} />}
              triggerClassName="nu-call-control__options"
              role="voice-share-options"
              dropUp
            >
              <MenuItem
                icon={includeSystemAudio ? 'check' : undefined}
                role="voice-share-system-audio"
                onSelect={() => {
                  setIncludeSystemAudio(!includeSystemAudio);
                  saveIncludeSystemAudio(!includeSystemAudio);
                }}
              >
                Share my computer’s sound too
              </MenuItem>
            </Menu>
          )}
        </div>
        <Menu
          label="Watch or listen together"
          trigger={
            <>
              <span className="nu-call-control__icon">
                <Icon name={sharedMode === 'listen' ? 'music' : 'tv'} size={20} />
              </span>
              <span className="nu-call-control__label">Together</span>
            </>
          }
          triggerClassName={sharedMode ? 'nu-call-control nu-call-control--on' : 'nu-call-control'}
          role="voice-together-menu"
          align="end"
          dropUp
        >
          <MenuItem icon="tv" role="voice-watch-together-toggle" onSelect={() => setWatchTogetherModal('watch')}>
            {sharedMode === 'watch' ? 'Change the video' : 'Watch a video together'}
          </MenuItem>
          <MenuItem icon="music" role="voice-listen-together-toggle" onSelect={() => setWatchTogetherModal('listen')}>
            {sharedMode === 'listen' ? 'Change the music' : 'Listen to music together'}
          </MenuItem>
        </Menu>
        <CallControl icon="phoneOff" label="Leave" state="leave" role="voice-leave" title="Leave the call" onClick={onLeave} />
      </div>
      {watchTogetherModal && watchTogether && (
        <WatchTogetherModal
          initialMode={watchTogetherModal}
          onClose={() => setWatchTogetherModal(null)}
          onStart={(url, mode) => watchTogether.start(url, mode)}
        />
      )}
    </>
  );
}
