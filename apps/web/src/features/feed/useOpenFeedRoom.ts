import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import {
  railSectionAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { readFeedMarker } from '../../matrix/feed';

/**
 * Opens the posts view a feed room belongs to — its Space's Posts page, or its owner's profile —
 * and reports whether the room was a feed at all. For notifications: a like or comment happens in a
 * feed room, which isn't somewhere to open as a channel.
 */
export function useOpenFeedRoom(): (room: Room) => boolean {
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setGlobalFeedOpen = useSetAtom(railSectionAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);

  return useCallback(
    (room: Room) => {
      const marker = readFeedMarker(room);
      if (!marker) return false;
      if (marker.spaceId && !marker.profile) {
        setProfileUserId(null);
        setGlobalFeedOpen('messages');
        setSelectedSpaceId(marker.spaceId);
        setSelectedRoomId(null);
        setSpaceView('feed');
      } else {
        setProfileUserId(marker.owner);
      }
      return true;
    },
    [setSelectedSpaceId, setSelectedRoomId, setSpaceView, setGlobalFeedOpen, setProfileUserId]
  );
}
