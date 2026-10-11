import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { unreadActivityCountAtom } from '../../app/state/feed';
import type { Room } from 'matrix-js-sdk';
import {
  globalFeedOpenAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
  socialViewAtom,
} from '../../app/state/selection';
import { UnreadBadge } from '../../components/UnreadBadge';
import { DiscoverModal } from '../discover/DiscoverModal';
import { useOpenSocial } from '../feed/useOpenSocial';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import { useInvites } from '../../matrix/hooks/useInvites';
import { useSpaceRooms } from '../../matrix/hooks/useSpaceRooms';
import { useSpacelessRooms } from '../../matrix/hooks/useSpacelessRooms';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { useAnyRoomHasUnread, useDirectMessageUnreads, useUnreadSummary } from '../../matrix/hooks/useUnreadCounts';
import { describeRoomLevel } from '../../matrix/notificationSettings';
import { CreateSpaceModal } from './CreateSpaceModal';
import { locateInList, usePointerDrag } from '../../components/usePointerDrag';
import { moveSpace } from '../../matrix/spaceOrder';
import { RailClock } from '../../app/StatusClock';
import { mobileSpacesOpenAtom } from '../../app/state/mobile';
import { nameHue } from '../../components/Avatar';
import { notifyAria } from '../invites/notifyAria';
import './ServerRail.css';

/** The selected tile's cat ears — drawn on every tile, shown only on the active one (CSS),
 *  so selecting a space animates them in rather than mounting a new element. */
function CatEars() {
  return (
    <svg className="nu-server-rail__ears" viewBox="0 0 48 14" aria-hidden="true" focusable="false">
      <path className="nu-server-rail__ear" d="M4 14 9.5 1.5 19 14z" />
      <path className="nu-server-rail__ear-inner" d="M8.5 14 10.3 7.5 14.6 14z" />
      <path className="nu-server-rail__ear" d="M29 14 38.5 1.5 44 14z" />
      <path className="nu-server-rail__ear-inner" d="M33.4 14 37.7 7.5 39.5 14z" />
    </svg>
  );
}

/** The rail's line icons, drawn the Ultimit way: square joins, one stroke weight. */
const RAIL_ICONS = {
  home: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  feed: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  notify: 'M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  discover: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  create: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8.5v7M8.5 12h7',
} as const;

function RailIcon({ name }: { name: keyof typeof RAIL_ICONS }) {
  return (
    <svg className="nu-server-rail__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" aria-hidden="true" focusable="false">
      <path d={RAIL_ICONS[name]} />
    </svg>
  );
}

/** Purrlor's emblem at the top of the rail: a cat's head inside a hexagon, in the rail's line. */
function Emblem() {
  return (
    <svg className="nu-server-rail__emblem" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
      <polygon points="24,4 41.3,14 41.3,34 24,44 6.7,34 6.7,14" />
      <path d="M15 31V17l5 4h8l5-4v14l-5 4h-8z" />
      <path d="M20 27h2M26 27h2" />
    </svg>
  );
}

/** A Space's initials for its hexagon: the first letters of its first two words, or its first two letters. */
export function spaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const initials = words.length > 1 ? Array.from(words[0])[0] + Array.from(words[1])[0] : Array.from(words[0]).slice(0, 2).join('');
  return initials.toUpperCase();
}

/** A Space's tile can be dragged to another place in the rail (usePointerDrag, matrix/spaceOrder.ts). */
type TileDrag = { dragging: boolean; clickAllowed: () => boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void };

function ServerRailItem({ space, active, onSelect, drag }: { space: Room; active: boolean; onSelect: () => void; drag?: TileDrag }) {
  const src = useMediaUrl(space.getMxcAvatarUrl(), { width: 96, height: 96, method: 'crop' });
  const mx = useMatrixClient();
  const rooms = useSpaceRooms(space.roomId);
  const unread = useUnreadSummary(rooms);
  // Something new the counts don't cover (a webhook's post, a message under "Only @mentions").
  const hasNew = useAnyRoomHasUnread(rooms, mx.getUserId() ?? '', (roomId) => describeRoomLevel(mx, roomId).effective === 'nothing');

  const className = [
    'nu-server-rail__item',
    active && 'nu-server-rail__item--active',
    (unread.total > 0 || hasNew) && 'nu-server-rail__item--unread',
    drag && 'nu-server-rail__item--draggable',
    drag?.dragging && 'nu-server-rail__item--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      data-nu-role="server-rail-item"
      title={space.name}
      aria-label={space.name}
      aria-current={active ? 'page' : undefined}
      data-nu-drag-space={space.roomId}
      onPointerDown={drag?.onPointerDown}
      onClick={() => {
        if (!drag || drag.clickAllowed()) onSelect();
      }}
    >
      <span className="nu-server-rail__icon">
        <CatEars />
        {/* A hexagon: its picture, or its initials on a color picked from its name. */}
        <span className="nu-server-rail__hex" style={{ ['--nu-hex-hue' as string]: nameHue(space.name || '?') }}>
          {src ? <img className="nu-server-rail__item-image" src={src} alt="" /> : spaceInitials(space.name || '?')}
        </span>
        <span className="nu-server-rail__item-badge">
          <UnreadBadge total={unread.total} highlight={unread.highlight} />
        </span>
      </span>
      <span className="nu-server-rail__label" aria-hidden="true">
        {space.name}
      </span>
    </button>
  );
}

/** How many unread DMs get their own tile under Home; the rest are in Home's count. */
const MAX_DM_TILES = 3;

/** An unread DM in the rail, under Home: who it's with, and how many messages, one click away. */
function DirectMessageRailItem({ room, count, onSelect }: { room: Room; count: number; onSelect: () => void }) {
  const mxc = room.getMxcAvatarUrl() ?? room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? null;
  const src = useMediaUrl(mxc, { width: 96, height: 96, method: 'crop' });
  const label = `${room.name}, ${count === 1 ? '1 unread message' : `${count > 99 ? '99+' : count} unread messages`}`;
  return (
    <button
      type="button"
      className="nu-server-rail__item nu-server-rail__item--dm nu-server-rail__item--unread"
      data-nu-role="server-rail-dm"
      title={label}
      aria-label={label}
      onClick={onSelect}
    >
      <span className="nu-server-rail__icon">
        <span className="nu-server-rail__person" style={{ ['--nu-hex-hue' as string]: nameHue(room.name || '?') }}>
          {src ? <img className="nu-server-rail__item-image" src={src} alt="" /> : (room.name || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="nu-server-rail__item-badge">
          <UnreadBadge total={count} highlight={count} />
        </span>
      </span>
      <span className="nu-server-rail__label" aria-hidden="true">
        {room.name}
      </span>
    </button>
  );
}

/** Left icon rail — one icon per joined Matrix Space, mapped to a Discord "server". */
export function ServerRail() {
  const mx = useMatrixClient();
  const storedSpaces = useSpaces();
  // Dragging a Space to another place (matrix/spaceOrder.ts): shown at once, saved behind it.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const storedIds = storedSpaces.map((space) => space.roomId).join('\n');
  useEffect(() => {
    if (!pendingOrder) return undefined;
    if (pendingOrder.join('\n') === storedIds) {
      setPendingOrder(null);
      return undefined;
    }
    const timer = setTimeout(() => setPendingOrder(null), 20_000);
    return () => clearTimeout(timer);
  }, [pendingOrder, storedIds]);
  const spaces = pendingOrder
    ? [
        ...pendingOrder.flatMap((id) => storedSpaces.filter((space) => space.roomId === id)),
        ...storedSpaces.filter((space) => !pendingOrder.includes(space.roomId)),
      ]
    : storedSpaces;
  const listRef = useRef<HTMLDivElement>(null);
  const spaceDrag = usePointerDrag<{ id: string; label: string }, number>({
    containerRef: listRef,
    enabled: true,
    locate: (item, clientY, container) => locateInList(container, 'data-nu-drag-space', item.id, clientY),
    drop: (item, index) => {
      const from = spaces.findIndex((space) => space.roomId === item.id);
      const ids = spaces.map((space) => space.roomId).filter((id) => id !== item.id);
      const at = Math.max(0, Math.min(from < index ? index - 1 : index, ids.length));
      const next = [...ids.slice(0, at), item.id, ...ids.slice(at)];
      if (next.join('\n') === spaces.map((space) => space.roomId).join('\n')) return;
      const before = spaces;
      setPendingOrder(next);
      moveSpace(mx, before, item.id, index).catch((err: unknown) => {
        console.error('Moving a Space failed', err);
        setPendingOrder(null);
      });
    },
  });
  const invites = useInvites();
  const [selectedSpaceId, setSelectedSpaceId] = useAtom(selectedSpaceIdAtom);
  const [, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const [globalFeedOpen, setGlobalFeedOpen] = useAtom(globalFeedOpenAtom);
  const socialView = useAtomValue(socialViewAtom);
  const unreadNotifications = useAtomValue(unreadActivityCountAtom);
  const openSocial = useOpenSocial();
  const onNotifications = globalFeedOpen && socialView === 'notifications';
  // Notify counts invites too: they're answered from the top of Notifications (InvitesWaiting).
  const notifyCount = unreadNotifications + invites.length;
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const spacelessRooms = useSpacelessRooms();
  const dmUnread = useUnreadSummary(spacelessRooms);
  // Every unread message in a DM counts, as a mention does in a channel (useDirectMessageUnreads);
  // DMs set to "Only @mentions" or muted keep to the server's counts above.
  const dmCounts = useDirectMessageUnreads(spacelessRooms, mx.getUserId() ?? '', (roomId) => describeRoomLevel(mx, roomId).effective !== 'all');
  const dmCountTotal = [...dmCounts.values()].reduce((sum, n) => sum + n, 0) + dmUnread.highlight;
  const unreadDms = spacelessRooms.filter((room) => dmCounts.has(room.roomId)).slice(0, MAX_DM_TILES);

  // A Space opens fresh, with nothing chosen in it: ChannelList then lands on its unseen news or its
  // first text channel (matrix/spaceNews.ts), rather than whatever view the last Space was on.
  // On a phone the rail is the Spaces screen (MobileTabBar.tsx): going anywhere from it closes it.
  const setMobileSpacesOpen = useSetAtom(mobileSpacesOpenAtom);
  const selectSpace = (id: string | null) => {
    setMobileSpacesOpen(false);
    setGlobalFeedOpen(false);
    setProfileUserId(null);
    setSelectedSpaceId(id);
    setSelectedRoomId(null);
    setSpaceView(null);
  };

  const openDirectMessage = (roomId: string) => {
    setMobileSpacesOpen(false);
    setGlobalFeedOpen(false);
    setProfileUserId(null);
    setSpaceView(null);
    setSelectedSpaceId(null);
    setSelectedRoomId(roomId);
  };

  return (
    <nav className="nu-server-rail" data-nu-role="server-rail">
      <Emblem />
      <button
        type="button"
        className={
          [
            'nu-server-rail__item',
            'nu-server-rail__item--home',
            selectedSpaceId === null && !globalFeedOpen && 'nu-server-rail__item--active',
            (dmCountTotal > 0 || dmUnread.total > 0) && 'nu-server-rail__item--unread',
          ]
            .filter(Boolean)
            .join(' ')
        }
        data-nu-role="server-rail-home"
        title="Direct Messages"
        aria-label={dmCountTotal > 0 ? `Direct Messages, ${dmCountTotal} unread` : 'Direct Messages'}
        onClick={() => selectSpace(null)}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="home" />
          <span className="nu-server-rail__item-badge">
            <UnreadBadge total={dmCountTotal || dmUnread.total} highlight={dmCountTotal} />
          </span>
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Home
        </span>
      </button>
      {unreadDms.map((room) => (
        <DirectMessageRailItem
          key={room.roomId}
          room={room}
          count={dmCounts.get(room.roomId) ?? 0}
          onSelect={() => openDirectMessage(room.roomId)}
        />
      ))}
      <div
        className={spaceDrag.dragging ? 'nu-server-rail__list nu-server-rail__list--dragging' : 'nu-server-rail__list'}
        data-nu-role="server-rail-list"
        ref={listRef}
      >
        {spaceDrag.lineTop !== null && <div className="nu-server-rail__drop-line" style={{ top: spaceDrag.lineTop }} aria-hidden="true" />}
        {spaces.map((space) => (
          <ServerRailItem
            key={space.roomId}
            drag={{
              dragging: spaceDrag.dragging?.id === space.roomId,
              clickAllowed: spaceDrag.clickAllowed,
              onPointerDown: (event) => spaceDrag.start({ id: space.roomId, label: space.name }, event),
            }}
            space={space}
            active={selectedSpaceId === space.roomId && !globalFeedOpen}
            onSelect={() => selectSpace(space.roomId)}
          />
        ))}
      </div>
      {spaceDrag.dragging && spaceDrag.pointer && (
        <div className="nu-server-rail__drag-label" style={{ left: spaceDrag.pointer.x + 14, top: spaceDrag.pointer.y + 14 }} aria-hidden="true">
          {spaceDrag.dragging.label}
        </div>
      )}
      <div className="nu-server-rail__divider" />
      <button
        type="button"
        className={
          globalFeedOpen && !onNotifications
            ? 'nu-server-rail__item nu-server-rail__item--global-feed nu-server-rail__item--active'
            : 'nu-server-rail__item nu-server-rail__item--global-feed'
        }
        data-nu-role="server-rail-global-feed"
        title="Global feed"
        aria-label="Global feed"
        aria-current={globalFeedOpen && !onNotifications ? 'page' : undefined}
        onClick={() => openSocial(socialView === 'notifications' ? 'everyone' : socialView)}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="feed" />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Feed
        </span>
      </button>
      {/* Everything that's about you, in one place: mentions anywhere, and what people did with
          your posts and profile (the social side's Notifications page). */}
      <button
        type="button"
        className={
          onNotifications
            ? 'nu-server-rail__item nu-server-rail__item--notifications nu-server-rail__item--active'
            : 'nu-server-rail__item nu-server-rail__item--notifications'
        }
        data-nu-role="server-rail-notifications"
        title="Notifications"
        aria-label={notifyAria(unreadNotifications, invites.length)}
        aria-current={onNotifications ? 'page' : undefined}
        onClick={() => openSocial('notifications')}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="notify" />
          <span className="nu-server-rail__item-badge">
            <UnreadBadge total={notifyCount} highlight={notifyCount} />
          </span>
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Notify
        </span>
      </button>
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--discover"
        data-nu-role="server-rail-discover"
        title="Discover public spaces and channels"
        aria-label="Discover"
        onClick={() => setShowDiscover(true)}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="discover" />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Discover
        </span>
      </button>
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--add"
        data-nu-role="server-rail-add"
        title="Create a Space"
        aria-label="Create a Space"
        onClick={() => setShowCreateSpace(true)}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="create" />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Create
        </span>
      </button>
      {/* The rest of the rail's height, between Create and the clock: the Spaces only take what they need. */}
      <div className="nu-server-rail__spacer" aria-hidden="true" />
      <RailClock />
      {/* The mockup's version line, running up the rail: the app and the server you're on. */}
      <div className="nu-server-rail__ver" aria-hidden="true">
        PURRLOR · {(mx.getDomain() ?? '').toUpperCase()}
      </div>
      {showCreateSpace && (
        <CreateSpaceModal
          onClose={() => setShowCreateSpace(false)}
          onCreated={(roomId) => {
            setShowCreateSpace(false);
            selectSpace(roomId);
          }}
        />
      )}
      {showDiscover && (
        <DiscoverModal
          onClose={() => setShowDiscover(false)}
          onJoinedSpace={(roomId) => selectSpace(roomId)}
        />
      )}
    </nav>
  );
}
