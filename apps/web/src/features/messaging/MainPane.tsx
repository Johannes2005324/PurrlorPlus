import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  globalFeedOpenAtom,
  railSectionAtom,
  socialSpaceIdAtom,
  openPostAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { desktopMemberListHiddenAtom, mobileMemberListOpenAtom } from '../../app/state/mobile';
import { Icon, type IconName } from '../../components/Icon';
import { useRoomEncrypted } from '../../matrix/hooks/useRoomEncrypted';
import { useChannelType } from '../../matrix/hooks/useChannelType';
import { usePinnedEventIds } from '../../matrix/hooks/usePinnedEventIds';
import { useRoom } from '../../matrix/hooks/useRoom';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { canInviteToRoom } from '../../matrix/permissions';
import type { ReplyTarget } from '../../matrix/replies';
import { FeedView } from '../feed/FeedView';
import { CalendarView } from '../calendar/CalendarView';
import { NewsView } from '../news/NewsView';
import { PostPage } from '../feed/PostPage';
import { GlobalFeedView } from '../feed/GlobalFeedView';
import { ProfileView } from '../feed/ProfileView';
import { MessageSearchModal } from '../search/MessageSearchModal';
import { VoiceChannelPanel } from '../voice/VoiceChannelPanel';
import { Composer } from './Composer';
import { InviteToChannelModal } from './InviteToChannelModal';
import { MessageTimeline } from './MessageTimeline';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { ThreadsOverviewModal } from './ThreadsOverviewModal';
import { TopicBanner } from './TopicBanner';
import { HomeView } from '../home/HomeView';
import { TypingIndicator } from './TypingIndicator';
import { NoSpacesYet, useInNoSpace } from '../onboarding/WelcomeGuideHost';
import { isDemoMode } from '../../demo/demoMode';
import './MainPane.css';

/** Same breakpoint as styles/base/shell.css's one-pane-at-a-time layout. */
const MOBILE_QUERY = '(max-width: 900px)';

/** A header toolbar button: an icon, plus a text label once there's room for one (CSS hides the
 *  label on narrower windows, leaving the icon and its tooltip). */
function HeaderAction({
  icon,
  label,
  role,
  pressed,
  className,
  onClick,
  children,
}: {
  icon: IconName;
  label: string;
  role: string;
  pressed?: boolean;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={['nu-main-pane__header-action', pressed && 'nu-main-pane__header-action--pressed', className].filter(Boolean).join(' ')}
      data-nu-role={role}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon name={icon} size={17} />
      <span className="nu-main-pane__header-action-label">{label}</span>
      {children}
    </button>
  );
}

/**
 * Main content area — a text channel's timeline, a voice channel's call panel, or the Space's
 * Posts feed (which isn't a channel at all, see matrix/feed.ts).
 *
 * The global feed, once opened, stays mounted from then on, hidden while something else is shown:
 * loading it reads every Space's and person's feed (useGlobalFeed), and going to a chat and back
 * used to read them all again. Kept, coming back is instant, on the same tab and scroll position,
 * and it doesn't check for new posts while it's out of sight.
 */
export function MainPane() {
  const mx = useMatrixClient();
  const globalFeedOpen = useAtomValue(globalFeedOpenAtom);
  const socialSpaceId = useAtomValue(socialSpaceIdAtom);
  const profileUserId = useAtomValue(profileUserIdAtom);
  const openPost = useAtomValue(openPostAtom);
  // The same test as MainPaneContent's `feed === 'global'`: open, and not showing one Space's Posts.
  const globalShown = globalFeedOpen && !(socialSpaceId && mx.getRoom(socialSpaceId));
  const visited = useRef(false);
  if (globalShown) visited.current = true;

  return (
    <>
      {visited.current && <GlobalFeedView hidden={!globalShown || !!profileUserId || !!openPost} />}
      <MainPaneContent />
    </>
  );
}

function MainPaneContent() {
  const inNoSpace = useInNoSpace();
  const mx = useMatrixClient();
  const [selectedRoomId, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const selectedSpaceId = useAtomValue(selectedSpaceIdAtom);
  const spaceView = useAtomValue(selectedSpaceViewAtom);
  const [globalFeedOpen] = useAtom(globalFeedOpenAtom);
  const [section, setSection] = useAtom(railSectionAtom);
  const [socialSpaceId, setSocialSpaceId] = useAtom(socialSpaceIdAtom);
  const [profileUserId, setProfileUserId] = useAtom(profileUserIdAtom);
  const [openPost, setOpenPost] = useAtom(openPostAtom);
  const room = useRoom(selectedRoomId);
  const channelType = useChannelType(room);
  const encrypted = useRoomEncrypted(room);
  const pinnedIds = usePinnedEventIds(selectedRoomId);
  const [showPinned, setShowPinned] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const setMobileMembersOpen = useSetAtom(mobileMemberListOpenAtom);
  const [membersHidden, setMembersHidden] = useAtom(desktopMemberListHiddenAtom);

  // A staged reply is tied to one room's composer — carrying it over to whatever's selected
  // next would silently attach it to an unrelated message.
  useEffect(() => {
    setReplyingTo(null);
    setMobileMembersOpen(false);
  }, [selectedRoomId, setMobileMembersOpen]);

  // A Space's Posts inside the social side goes with the social side.
  useEffect(() => {
    if (!globalFeedOpen) setSocialSpaceId(null);
  }, [globalFeedOpen, setSocialSpaceId]);

  // Any route to a room — a channel click, a notification, a search result, the call bar — means
  // the user wants that room, not the global feed sitting on top of it.
  // Not when the section changed in the same step (Back or Forward putting a whole view back).
  const lastSection = useRef(section);
  useEffect(() => {
    const sectionChanged = lastSection.current !== section;
    lastSection.current = section;
    if (!selectedRoomId || sectionChanged) return;
    setSection('messages');
    setProfileUserId(null);
  }, [selectedRoomId, section, setSection, setProfileUserId]);

  // A post's page sits over whatever it was opened from, and going anywhere else — a channel,
  // a Space, the global feed, a profile — closes it. Opening a post changes none of these, so it
  // survives its own opening; Back (in PostPage) returns to what was underneath.
  useEffect(() => {
    setOpenPost(null);
  }, [selectedRoomId, selectedSpaceId, spaceView, section, profileUserId, setOpenPost]);

  // Feeds are a merge across many rooms rather than one selected room, so they take precedence
  // over whatever channel happens to still be selected behind them. A profile sits over a feed,
  // and a post's page over either. What's underneath stays mounted, just hidden, so Back lands on
  // the same tab and scroll position instead of reloading the feed from the top.
  // A Space's Posts opened from the social side's sidebar (socialSpaceIdAtom) stands in for the
  // global feed there; opened from its channel list, it's the Space's own page.
  const inHome = section === 'home';
  const socialSpace = globalFeedOpen && socialSpaceId ? mx.getRoom(socialSpaceId) : null;
  const feedSpace = socialSpace ?? (!inHome && spaceView === 'feed' && selectedSpaceId ? mx.getRoom(selectedSpaceId) : null);
  const feed = socialSpace ? 'space' : globalFeedOpen ? 'global' : feedSpace ? 'space' : null;
  // Home is its own page; a profile or post opened from it sits over it, as over any section.
  if (inHome && !profileUserId && !openPost) return <HomeView />;
  const calendarSpace = spaceView === 'events' && selectedSpaceId && !globalFeedOpen ? mx.getRoom(selectedSpaceId) : null;
  if (calendarSpace && !profileUserId && !openPost) return <CalendarView key={calendarSpace.roomId} space={calendarSpace} />;
  const newsSpace = spaceView === 'news' && selectedSpaceId && !globalFeedOpen ? mx.getRoom(selectedSpaceId) : null;
  if (newsSpace && !profileUserId && !openPost) return <NewsView key={newsSpace.roomId} space={newsSpace} />;
  if (feed || profileUserId || openPost) {
    const covered = !!profileUserId || !!openPost;
    return (
      <>
        {/* The global feed itself is MainPane's, kept mounted there. */}
        {feed === 'space' && feedSpace && (
          <FeedView key={feedSpace.roomId} space={feedSpace} hidden={covered} onBack={socialSpace ? () => setSocialSpaceId(null) : undefined} />
        )}
        {profileUserId && <ProfileView key={profileUserId} userId={profileUserId} hidden={!!openPost} />}
        {openPost && <PostPage key={openPost.postId} post={openPost} />}
      </>
    );
  }

  // One Members button for both layouts: on mobile it opens the slide-in drawer, on desktop it
  // shows/hides the member list column.
  const toggleMembers = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) setMobileMembersOpen((open) => !open);
    else setMembersHidden((hidden) => !hidden);
  };

  if (!room) {
    // Someone in no Space yet gets the ways in, not "pick a channel" with no channels to pick.
    if (inNoSpace && !isDemoMode()) {
      return (
        <main className="nu-main-pane" data-nu-role="main-pane">
          <NoSpacesYet />
        </main>
      );
    }
    return (
      <main className="nu-main-pane" data-nu-role="main-pane">
        <div className="nu-main-pane__empty" data-nu-role="main-pane-empty">
          <Icon name="paw" size={40} className="nu-main-pane__empty-icon" />
          <p className="nu-main-pane__empty-title">Nothing open yet</p>
          <p className="nu-main-pane__empty-hint">Pick a channel on the left to start chatting.</p>
        </div>
      </main>
    );
  }

  const canInvite = canInviteToRoom(room, mx.getUserId() ?? '');
  const backButton = (
    <button
      type="button"
      className="nu-main-pane__header-back"
      data-nu-role="main-pane-back"
      title="Back to channels"
      aria-label="Back to channels"
      onClick={() => setSelectedRoomId(null)}
    >
      <Icon name="arrowLeft" size={18} />
    </button>
  );

  if (channelType === 'voice') {
    return (
      <main className="nu-main-pane" data-nu-role="main-pane">
        <div className="nu-main-pane__header" data-nu-role="main-pane-header">
          {backButton}
          <Icon name="volume" size={20} className="nu-main-pane__header-icon" />
          <h1 className="nu-main-pane__header-name">{room.name}</h1>
          {canInvite && (
            <div className="nu-main-pane__header-actions">
              <HeaderAction icon="userPlus" label="Invite" role="main-pane-invite" onClick={() => setShowInvite(true)} />
            </div>
          )}
        </div>
        <VoiceChannelPanel room={room} />
        {showInvite && <InviteToChannelModal room={room} onClose={() => setShowInvite(false)} />}
      </main>
    );
  }

  return (
    <main className="nu-main-pane" data-nu-role="main-pane">
      <div className="nu-main-pane__header" data-nu-role="main-pane-header">
        {backButton}
        <Icon name="hash" size={20} className="nu-main-pane__header-icon" />
        <h1 className="nu-main-pane__header-name">{room.name}</h1>
        {encrypted && (
          <span className="nu-main-pane__header-lock" title="End-to-end encrypted" data-nu-role="main-pane-encrypted">
            <Icon name="lock" size={14} />
          </span>
        )}
        {/* The window's subtitle and the rule that runs out to its buttons (the Ultimit frame). */}
        <span className="nu-main-pane__header-sub" data-nu-role="main-pane-sub">
          {room.getJoinedMemberCount() === 1 ? '1 member' : `${room.getJoinedMemberCount()} members`}
        </span>
        <span className="nu-main-pane__header-rule" aria-hidden="true" />
        <div className="nu-main-pane__header-actions">
          <HeaderAction icon="pin" label="Pinned" role="main-pane-pins" onClick={() => setShowPinned(true)}>
            {pinnedIds.length > 0 && <span className="nu-main-pane__header-count">{pinnedIds.length}</span>}
          </HeaderAction>
          <HeaderAction icon="threads" label="Threads" role="main-pane-threads" onClick={() => setShowThreads(true)} />
          {canInvite && (
            <HeaderAction icon="userPlus" label="Invite" role="main-pane-invite" onClick={() => setShowInvite(true)} />
          )}
          <HeaderAction
            icon="users"
            label="Members"
            role="main-pane-members-toggle"
            className="nu-main-pane__header-members-toggle"
            pressed={!membersHidden}
            onClick={toggleMembers}
          />
          <button
            type="button"
            className="nu-main-pane__header-search"
            data-nu-role="main-pane-search"
            onClick={() => setShowSearch(true)}
          >
            <span>Search</span>
            <Icon name="search" size={15} />
          </button>
        </div>
      </div>
      <TopicBanner room={room} />
      <MessageTimeline roomId={room.roomId} onReply={setReplyingTo} />
      <TypingIndicator roomId={room.roomId} />
      <Composer roomId={room.roomId} autoFocus replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} />
      {showPinned && <PinnedMessagesPanel room={room} onClose={() => setShowPinned(false)} />}
      {showSearch && <MessageSearchModal roomId={room.roomId} onClose={() => setShowSearch(false)} />}
      {showThreads && <ThreadsOverviewModal room={room} onClose={() => setShowThreads(false)} />}
      {showInvite && <InviteToChannelModal room={room} onClose={() => setShowInvite(false)} />}
    </main>
  );
}
