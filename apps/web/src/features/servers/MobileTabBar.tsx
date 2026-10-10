import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { unreadActivityCountAtom } from '../../app/state/feed';
import { mobileSpacesOpenAtom } from '../../app/state/mobile';
import {
  globalFeedOpenAtom,
  openPostAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
  socialViewAtom,
} from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { useSpacelessRooms } from '../../matrix/hooks/useSpacelessRooms';
import { useDirectMessageUnreads, useUnreadSummary } from '../../matrix/hooks/useUnreadCounts';
import { describeRoomLevel } from '../../matrix/notificationSettings';
import { useOpenSocial } from '../feed/useOpenSocial';
import './MobileTabBar.css';

const ICONS = {
  home: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  spaces: 'M7 3l4 2.3v4.6L7 12.2 3 9.9V5.3zM17 3l4 2.3v4.6l-4 2.3-4-2.3V5.3zM12 11.8l4 2.3v4.6L12 21l-4-2.3v-4.6z',
  feed: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  notify: 'M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
} as const;

function Glyph({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="nu-mobile-tabs__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

function Count({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="nu-mobile-tabs__count">{n > 99 ? '99+' : n}</span>;
}

/**
 * The phone layout's way around, from the Ultimit mockup's phone screen: a bar along the bottom
 * with Home (your DMs), Spaces (every Space, as a grid: the server rail laid out flat), Feed,
 * Notify and You (your own profile). It stands in for the server rail, which on a phone took a
 * strip off every screen and had no way to your own profile at all. Only below the responsive
 * breakpoint (styles/base/frame.css); hidden while the keyboard is up.
 */
export function MobileTabBar() {
  const mx = useMatrixClient();
  const me = useOwnProfile();
  const [spacesOpen, setSpacesOpen] = useAtom(mobileSpacesOpenAtom);
  const globalFeedOpen = useAtomValue(globalFeedOpenAtom);
  const socialView = useAtomValue(socialViewAtom);
  const selectedSpaceId = useAtomValue(selectedSpaceIdAtom);
  const [profileUserId, setProfileUserId] = useAtom(profileUserIdAtom);
  const setGlobalFeedOpen = useSetAtom(globalFeedOpenAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const setOpenPost = useSetAtom(openPostAtom);
  const openSocial = useOpenSocial();
  const unreadNotifications = useAtomValue(unreadActivityCountAtom);
  // Home's count, worked out as the rail's Home tile does (ServerRail.tsx).
  const spacelessRooms = useSpacelessRooms();
  const dmUnread = useUnreadSummary(spacelessRooms);
  const dmCounts = useDirectMessageUnreads(spacelessRooms, mx.getUserId() ?? '', (roomId) => describeRoomLevel(mx, roomId).effective !== 'all');
  const dmCount = [...dmCounts.values()].reduce((sum, n) => sum + n, 0) + dmUnread.highlight;

  const onProfile = !!profileUserId && profileUserId === me.userId;
  const onNotify = !spacesOpen && globalFeedOpen && socialView === 'notifications' && !profileUserId;
  const onFeed = !spacesOpen && globalFeedOpen && !onNotify && !profileUserId;
  const onHome = !spacesOpen && !globalFeedOpen && !profileUserId && selectedSpaceId === null;
  const onSpaces = spacesOpen || (!globalFeedOpen && !profileUserId && selectedSpaceId !== null);

  const tabs = [
    {
      key: 'home',
      label: 'Home',
      aria: dmCount > 0 ? `Home: direct messages, ${dmCount} unread` : 'Home: direct messages',
      active: onHome,
      icon: <Glyph name="home" />,
      count: dmCount,
      go: () => {
        setSpacesOpen(false);
        setGlobalFeedOpen(false);
        setProfileUserId(null);
        setOpenPost(null);
        setSpaceView(null);
        setSelectedSpaceId(null);
        setSelectedRoomId(null);
      },
    },
    { key: 'spaces', label: 'Spaces', aria: 'Spaces', active: onSpaces, icon: <Glyph name="spaces" />, count: 0, go: () => setSpacesOpen(true) },
    {
      key: 'feed',
      label: 'Feed',
      aria: 'Feed',
      active: onFeed,
      icon: <Glyph name="feed" />,
      count: 0,
      go: () => {
        setSpacesOpen(false);
        openSocial(socialView === 'notifications' ? 'everyone' : socialView);
      },
    },
    {
      key: 'notify',
      label: 'Notify',
      aria: unreadNotifications > 0 ? `Notifications, ${unreadNotifications} new` : 'Notifications',
      active: onNotify,
      icon: <Glyph name="notify" />,
      count: unreadNotifications,
      go: () => {
        setSpacesOpen(false);
        openSocial('notifications');
      },
    },
    {
      key: 'you',
      label: 'You',
      aria: 'Your profile',
      active: onProfile,
      icon: (
        <span className="nu-mobile-tabs__avatar">
          <Avatar name={me.displayName} mxcUrl={me.avatarUrl} size={24} />
        </span>
      ),
      count: 0,
      go: () => {
        // Your profile sits on the social side, like everyone's: Back from it goes to the feed.
        setSpacesOpen(false);
        setOpenPost(null);
        setGlobalFeedOpen(true);
        setProfileUserId(me.userId);
      },
    },
  ];

  return (
    <nav className="nu-mobile-tabs" data-nu-role="mobile-tabs" aria-label="Sections">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={tab.active ? 'nu-mobile-tabs__tab nu-mobile-tabs__tab--active' : 'nu-mobile-tabs__tab'}
          data-nu-role={`mobile-tab-${tab.key}`}
          aria-label={tab.aria}
          aria-current={tab.active ? 'page' : undefined}
          onClick={tab.go}
        >
          <span className="nu-mobile-tabs__icon">
            {tab.icon}
            <Count n={tab.count} />
          </span>
          <span className="nu-mobile-tabs__label" aria-hidden="true">
            {tab.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
