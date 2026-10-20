import { useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { unreadActivityCountAtom } from '../../app/state/feed';
import {
  openPostAtom,
  profileUserIdAtom,
  railSectionAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
  socialViewAtom,
} from '../../app/state/selection';
import { UnreadBadge } from '../../components/UnreadBadge';
import { DiscoverModal } from '../discover/DiscoverModal';
import { useOpenSocial } from '../feed/useOpenSocial';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useInvites } from '../../matrix/hooks/useInvites';
import { useSpacelessRooms } from '../../matrix/hooks/useSpacelessRooms';
import { useDirectMessageUnreads, useUnreadSummary } from '../../matrix/hooks/useUnreadCounts';
import { describeRoomLevel } from '../../matrix/notificationSettings';
import { CreateSpaceModal } from './CreateSpaceModal';
import { AccountSettingsModal } from '../../app/AccountSettingsModal';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { useOwnPresence } from '../../matrix/hooks/useOwnPresence';
import { StatusMenu } from '../account/StatusMenu';
import { RailClock } from '../../app/StatusClock';
import { mobileColumnOpenAtom } from '../../app/state/mobile';
import { Avatar } from '../../components/Avatar';
import { notifyAria } from '../invites/notifyAria';
import './ServerRail.css';

/** The rail's line icons, drawn the Ultimit way: square joins, one stroke weight. */
const RAIL_ICONS = {
  home: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  chat: 'M4 4h16v12H9l-5 4zM8 8.5h8M8 12h5',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
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

/** The app's main navigation: Home, Feed and Chat (Direct messages and Spaces live in its column), then Notifications, Discover and Create, with your profile and settings at the foot. */
export function ServerRail() {
  const mx = useMatrixClient();
  const invites = useInvites();
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const [section, setSection] = useAtom(railSectionAtom);
  const globalFeedOpen = section === 'feed';
  const setOpenPost = useSetAtom(openPostAtom);
  const [profileUserId, setProfileUserId] = useAtom(profileUserIdAtom);
  const me = useOwnProfile();
  const [showSettings, setShowSettings] = useState(false);
  const ownPresence = useOwnPresence();
  // Profile opens a small menu (View profile, your status, Edit profile) beside the rail.
  const [statusMenuAt, setStatusMenuAt] = useState<{ left: number; bottom: number } | null>(null);
  const socialView = useAtomValue(socialViewAtom);
  const unreadNotifications = useAtomValue(unreadActivityCountAtom);
  const openSocial = useOpenSocial();
  const onNotifications = globalFeedOpen && socialView === 'notifications';
  // Notify counts invites too: they're answered from the top of Notifications (InvitesWaiting).
  const notifyCount = unreadNotifications + invites.length;
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const spacelessRooms = useSpacelessRooms();
  const dmUnread = useUnreadSummary(spacelessRooms);
  // Every unread message in a DM counts, as a mention does in a channel (useDirectMessageUnreads);
  // DMs set to "Only @mentions" or muted keep to the server's counts above.
  const dmCounts = useDirectMessageUnreads(spacelessRooms, mx.getUserId() ?? '', (roomId) => describeRoomLevel(mx, roomId).effective !== 'all');
  const dmCountTotal = [...dmCounts.values()].reduce((sum, n) => sum + n, 0) + dmUnread.highlight;

  // A Space opens fresh, with nothing chosen in it: ChannelList then lands on its unseen news or its
  // first text channel (matrix/spaceNews.ts), rather than whatever view the last Space was on.
  // On a phone the rail is the Spaces screen (MobileTabBar.tsx): going anywhere from it closes it.
  const setMobileColumnOpen = useSetAtom(mobileColumnOpenAtom);
  const selectSpace = (id: string | null) => {
    setMobileColumnOpen(false);
    setSection('messages');
    setProfileUserId(null);
    setSelectedSpaceId(id);
    setSelectedRoomId(null);
    setSpaceView(null);
  };

  // Home is a page of its own, and Chat comes back to where you left it (the Space and room are
  // still in their atoms); clicking Chat while already there goes to its top level (Direct messages and Spaces).
  const goHome = () => {
    setMobileColumnOpen(false);
    setOpenPost(null);
    setProfileUserId(null);
    setSection('home');
  };
  const goChat = () => {
    if (section === 'messages') {
      selectSpace(null);
      return;
    }
    setMobileColumnOpen(false);
    setOpenPost(null);
    setProfileUserId(null);
    setSection('messages');
  };
  // Your profile sits on the social side, like everyone's (as MobileTabBar's You tab does).
  const openOwnProfile = () => {
    setMobileColumnOpen(false);
    setOpenPost(null);
    setSection('feed');
    setProfileUserId(me.userId);
  };
  const onOwnProfile = !!profileUserId && profileUserId === me.userId;

  return (
    <nav className="nu-server-rail" data-nu-role="server-rail">
      <Emblem />
      {/* Home: the dashboard, "Here's what's happening" (features/home/HomeView.tsx). */}
      <button
        type="button"
        className={section === 'home' ? 'nu-server-rail__item nu-server-rail__item--home nu-server-rail__item--active' : 'nu-server-rail__item nu-server-rail__item--home'}
        data-nu-role="server-rail-home"
        title="Home"
        aria-label="Home"
        aria-current={section === 'home' ? 'page' : undefined}
        onClick={goHome}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="home" />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Home
        </span>
      </button>
      {/* Feed: the social side. */}
      <button
        type="button"
        className={
          globalFeedOpen
            ? 'nu-server-rail__item nu-server-rail__item--global-feed nu-server-rail__item--active'
            : 'nu-server-rail__item nu-server-rail__item--global-feed'
        }
        data-nu-role="server-rail-global-feed"
        title="Global feed"
        aria-label="Global feed"
        aria-current={globalFeedOpen ? 'page' : undefined}
        onClick={() => openSocial(socialView === 'notifications' ? 'everyone' : socialView)}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="feed" />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Feed
        </span>
      </button>
      {/* Chat: Direct messages and Spaces, in the channel column. */}
      <button
        type="button"
        className={
          [
            'nu-server-rail__item',
            'nu-server-rail__item--chat',
            section === 'messages' && 'nu-server-rail__item--active',
            (dmCountTotal > 0 || dmUnread.total > 0) && 'nu-server-rail__item--unread',
          ]
            .filter(Boolean)
            .join(' ')
        }
        data-nu-role="server-rail-chat"
        title="Chat"
        aria-label={dmCountTotal > 0 ? `Chat, ${dmCountTotal} unread` : 'Chat'}
        aria-current={section === 'messages' ? 'page' : undefined}
        onClick={goChat}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="chat" />
          <span className="nu-server-rail__item-badge">
            <UnreadBadge total={dmCountTotal || dmUnread.total} highlight={dmCountTotal} />
          </span>
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Chat
        </span>
      </button>
      <div className="nu-server-rail__divider" />
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
      <button
        type="button"
        className={onOwnProfile ? 'nu-server-rail__item nu-server-rail__item--profile nu-server-rail__item--active' : 'nu-server-rail__item nu-server-rail__item--profile'}
        data-nu-role="server-rail-profile"
        title="Your profile and status"
        aria-label="Your profile and status"
        aria-haspopup="menu"
        aria-expanded={statusMenuAt !== null}
        aria-current={onOwnProfile ? 'page' : undefined}
        // So the menu's own outside-click handler doesn't close it just before this click reopens it.
        onPointerDown={(event) => event.nativeEvent.stopPropagation()}
        onClick={(event) => {
          if (statusMenuAt) {
            setStatusMenuAt(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setStatusMenuAt({ left: rect.right + 8, bottom: Math.max(8, window.innerHeight - rect.bottom) });
        }}
      >
        <span className="nu-server-rail__icon">
          <Avatar name={me.displayName} mxcUrl={me.avatarUrl} size={28} presence={ownPresence.presence ?? 'offline'} />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Profile
        </span>
      </button>
      {statusMenuAt && (
        <StatusMenu
          current={ownPresence.presence}
          style={{ left: statusMenuAt.left, bottom: statusMenuAt.bottom }}
          onClose={() => setStatusMenuAt(null)}
          onViewProfile={() => {
            setStatusMenuAt(null);
            openOwnProfile();
          }}
          onEditProfile={() => {
            setStatusMenuAt(null);
            setShowSettings(true);
          }}
        />
      )}
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--settings"
        data-nu-role="server-rail-settings"
        title="Settings"
        aria-label="Settings"
        onClick={() => setShowSettings(true)}
      >
        <span className="nu-server-rail__icon">
          <RailIcon name="settings" />
        </span>
        <span className="nu-server-rail__label" aria-hidden="true">
          Settings
        </span>
      </button>
      <RailClock />
      {/* The mockup's version line, running up the rail: the app and the server you're on. */}
      <div className="nu-server-rail__ver" aria-hidden="true">
        PURRLOR · {(mx.getDomain() ?? '').toUpperCase()}
      </div>
      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
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
