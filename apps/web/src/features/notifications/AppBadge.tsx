import { useEffect, useRef } from 'react';
import { ClientEvent, NotificationCountType, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { listSpacelessRooms } from '../../matrix/spacelessRooms';
import { desktopBridge } from '../../desktop/desktopBridge';
import { readChannelType } from '../../matrix/channelType';
import { isBackgroundRoom } from '../../matrix/backgroundRooms';

/**
 * Whether a room's counts can be seen and cleared in the app. Feed rooms are read as posts, never
 * as a timeline, so nothing sends them a read receipt (MessageTimeline.tsx does that), and a post
 * that mentions you is shown and read in Notify instead; background rooms aren't shown at all.
 * Their server counts would sit on the badge for good, with nothing in the app to show or clear.
 */
function isShownAsChat(room: Room): boolean {
  return !room.isSpaceRoom() && readChannelType(room) !== 'feed' && !isBackgroundRoom(room);
}

/**
 * The count on the app's icon: the desktop app's taskbar button, or an installed app's icon
 * (navigator.setAppBadge). It counts what's waiting for you personally: every unread message in a
 * DM or group chat (the rooms outside any Space, as the Home badge counts them), and mentions
 * everywhere else. A busy channel's ordinary chatter doesn't count, the way the server rail's
 * badges don't. The counts are the homeserver's own (see useUnreadCounts.ts); this recounts after
 * each sync, which is when they change. Headless, mounted once in AppShell.
 */
export function AppBadge() {
  const mx = useMatrixClient();
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

    const update = () => {
      const chats = new Set(listSpacelessRooms(mx).map((room) => room.roomId));
      let count = 0;
      for (const room of mx.getRooms()) {
        if (room.getMyMembership() !== 'join' || !isShownAsChat(room)) continue;
        count += room.getUnreadNotificationCount(chats.has(room.roomId) ? NotificationCountType.Total : NotificationCountType.Highlight);
      }
      if (count === shown.current) return;
      shown.current = count;
      if (bridge) bridge.request('setBadge', { count }).catch(() => undefined); // desktop 1.1.0 has no badge
      else if (nav.setAppBadge) void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => undefined);
    };

    update();
    mx.on(ClientEvent.Sync, update);
    return () => {
      mx.removeListener(ClientEvent.Sync, update);
      // Signing out leaves nothing waiting.
      if (shown.current) {
        if (bridge) bridge.request('setBadge', { count: 0 }).catch(() => undefined);
        else void nav.clearAppBadge?.().catch(() => undefined);
      }
      shown.current = null;
    };
  }, [mx]);

  return null;
}
