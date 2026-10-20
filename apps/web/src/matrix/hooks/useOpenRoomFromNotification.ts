import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { mobileColumnOpenAtom } from '../../app/state/mobile';
import {
  globalFeedOpenAtom,
  openPostAtom,
  profileUserIdAtom,
  railSectionAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { readMentionInvite } from '../mentionInvites';
import { useMatrixClient } from '../MatrixClientContext';
import { getParentSpace } from '../voice';
import { useOpenFeedRoom } from '../../features/feed/useOpenFeedRoom';

/**
 * Two ways a background push notification (sw.js) hands control back to the app: a page that
 * was already open gets a postMessage from the service worker; a freshly-opened tab (nothing was
 * open) gets `?openRoom=` in its own URL instead, since `clients.openWindow()` can only navigate
 * to a URL, not talk to the page that loads from it. Both end up here. Also resolves the room's
 * parent Space so the channel list shows the right sidebar, not just the right message pane.
 */
export function useOpenRoomFromNotification(): void {
  const mx = useMatrixClient();
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const openFeedRoom = useOpenFeedRoom();
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const setGlobalFeedOpen = useSetAtom(globalFeedOpenAtom);
  const setOpenPost = useSetAtom(openPostAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setMobileColumnOpen = useSetAtom(mobileColumnOpenAtom);

  useEffect(() => {
    const openRoom = (roomId: string) => {
      const room = mx.getRoom(roomId);
      if (!room) return; // sync hasn't caught up with this room yet — nothing more to do
      // A like or comment on your post: open its posts view, not the feed room as a channel.
      if (openFeedRoom(room)) return;
      // A Global-post mention not accepted yet (MentionInviteAcceptor is on it): the author's posts.
      const mention = readMentionInvite(mx, room);
      if (mention) {
        setProfileUserId(mention.inviter);
        return;
      }
      // Off whatever was showing over the chat (the feed, a profile, a post, a Space's Posts, the
      // phone's Chat column): the room was chosen underneath it and never came into view.
      setGlobalFeedOpen(false);
      setProfileUserId(null);
      setOpenPost(null);
      setSpaceView(null);
      setMobileColumnOpen(false);
      setSelectedSpaceId(getParentSpace(mx, room)?.roomId ?? null);
      setSelectedRoomId(roomId);
      setRailSection('messages');
    };

    const params = new URLSearchParams(window.location.search);
    const openRoomId = params.get('openRoom');
    if (openRoomId) {
      openRoom(openRoomId);
      params.delete('openRoom');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }

    if (!('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'nekous-open-room' && event.data.roomId) {
        openRoom(event.data.roomId);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [
    mx,
    setSelectedSpaceId,
    setSelectedRoomId,
    openFeedRoom,
    setProfileUserId,
    setRailSection,
    setGlobalFeedOpen,
    setOpenPost,
    setSpaceView,
    setMobileColumnOpen,
  ]);
}
