import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import {
  activeVoiceChannelIdAtom,
  railSectionAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { getParentSpace } from '../../matrix/voice';

/**
 * Opens a voice channel and joins its call in one step: what a watch party's Join buttons do
 * (the start reminder, and the countdown in the channel). Joining the same call you're already in
 * does nothing more than show it.
 */
export function useJoinVoiceChannel(): (channelId: string) => void {
  const mx = useMatrixClient();
  const setSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setRoomId = useSetAtom(selectedRoomIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setGlobalFeedOpen = useSetAtom(railSectionAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const setActiveVoiceChannelId = useSetAtom(activeVoiceChannelIdAtom);

  return useCallback(
    (channelId: string) => {
      const room = mx.getRoom(channelId);
      setGlobalFeedOpen('messages');
      setProfileUserId(null);
      setSpaceView(null);
      setSpaceId(room ? (getParentSpace(mx, room)?.roomId ?? null) : null);
      setRoomId(channelId);
      setActiveVoiceChannelId(channelId);
    },
    [mx, setSpaceId, setRoomId, setSpaceView, setGlobalFeedOpen, setProfileUserId, setActiveVoiceChannelId]
  );
}
