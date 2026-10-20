import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { ServerRail } from '../features/servers/ServerRail';
import { ChannelList } from '../features/channels/ChannelList';
import { MainPane } from '../features/messaging/MainPane';
import { MemberList } from '../features/members/MemberList';
import { DesktopNotifications } from '../features/notifications/DesktopNotifications';
import { AppBadge } from '../features/notifications/AppBadge';
import { AutoAway } from '../features/account/AutoAway';
import { useNavigationHistory } from './navigationHistory';
import { NotificationRules } from '../features/notifications/NotificationRules';
import { FeedGovernance } from '../features/feed/FeedGovernance';
import { FollowPublisher } from '../features/feed/FollowPublisher';
import { ChannelGovernance } from '../features/channels/ChannelGovernance';
import { ModerationWatcher } from '../features/moderation/ModerationWatcher';
import { HistoryPrefetch } from '../features/messaging/HistoryPrefetch';
import { ReminderWatcher } from '../features/reminders/ReminderWatcher';
import { ActivityWatcher } from '../features/notifications/ActivityWatcher';
import { MentionInboxCollector } from '../features/notifications/MentionInboxCollector';
import { MentionInviteAcceptor } from '../features/notifications/MentionInviteAcceptor';
import { SpaceAutoJoiner } from '../features/servers/SpaceAutoJoiner';
import { EmoteLibraryWatcher } from '../features/messaging/EmoteLibraryWatcher';
import { IncomingVerificationListener } from '../features/security/IncomingVerificationListener';
import { RecoveryKeyPrompt } from '../features/security/RecoveryKeyPrompt';
import { VoiceCallSession } from '../features/voice/VoiceCallSession';
import { DemoModeBanner } from '../demo/DemoModeBanner';
import { isDemoMode } from '../demo/demoMode';
import { useComposeShortcut } from '../features/feed/useComposeShortcut';
import { useShareTarget } from '../features/feed/useShareTarget';
import { useOpenPublicRoute } from '../features/publicWeb/useOpenPublicRoute';
import { musicQueueAtom } from '../features/music/musicPlayer';
import { MusicPlayerBar } from '../features/music/MusicPlayerBar';
import { MusicPlayerHost } from '../features/music/MusicPlayerHost';
import { useOnlinePing } from '../features/online/useOnlinePing';
import { InstallHint } from './InstallHint';
import { StatusClock } from './StatusClock';
import { useTickerOn } from './effects';
import { NotificationTicker } from '../features/notifications/NotificationTicker';
import { FeedSidebar } from '../features/feed/FeedSidebar';
import { MobileTabBar } from '../features/servers/MobileTabBar';
import { Wallpaper } from '../components/Wallpaper';
import { useVisualViewport } from './useVisualViewport';
import { CommissionAlerts } from '../features/profilePage/CommissionAlerts';
import { useJoinFromInviteLink } from '../matrix/hooks/useJoinFromInviteLink';
import { useOpenRoomFromNotification } from '../matrix/hooks/useOpenRoomFromNotification';
import { useRecoveryStatus } from '../matrix/hooks/useRecoveryStatus';
import { WelcomeGuideHost } from '../features/onboarding/WelcomeGuideHost';
import { openPostAtom, globalFeedOpenAtom, railSectionAtom, profileUserIdAtom, selectedRoomIdAtom, selectedSpaceViewAtom } from './state/selection';
import { desktopMemberListHiddenAtom, mobileMemberListOpenAtom, mobileSpacesOpenAtom } from './state/mobile';

/** Real Discord-shaped three-pane shell, wired to live Matrix data (Phase 1+). */
export function AppShell() {
  const recoveryStatus = useRecoveryStatus();
  const [recoveryResolved, setRecoveryResolved] = useState(false);
  const selectedRoomId = useAtomValue(selectedRoomIdAtom);
  const [mobileMembersOpen, setMobileMembersOpen] = useAtom(mobileMemberListOpenAtom);
  const membersHidden = useAtomValue(desktopMemberListHiddenAtom);
  // The social side (the global feed, a profile, a post) and a Space's Posts and Events span many
  // rooms, so there's no one member list that belongs beside them. With no room open at all there
  // are no members to list, and an empty column just looked unfinished.
  const globalFeedOpen = useAtomValue(globalFeedOpenAtom);
  const onHome = useAtomValue(railSectionAtom) === 'home';
  const spaceView = useAtomValue(selectedSpaceViewAtom);
  const profileOpen = !!useAtomValue(profileUserIdAtom);
  const postOpen = !!useAtomValue(openPostAtom);
  const musicOn = !!useAtomValue(musicQueueAtom);
  const tickerOn = useTickerOn();
  const mobileSpacesOpen = useAtomValue(mobileSpacesOpenAtom);
  // On a phone the main pane only shows once there's something in it: a room, a Space's Posts,
  // or the global feed. The last two aren't rooms, so a room check alone left them invisible.
  const mainPaneHasContent = onHome || !!selectedRoomId || spaceView !== null || globalFeedOpen || profileOpen || postOpen;
  useOpenRoomFromNotification();
  useNavigationHistory();
  useVisualViewport();
  useComposeShortcut();
  useShareTarget();
  useOpenPublicRoute();
  useOnlinePing();
  const inviteLinkJoin = useJoinFromInviteLink();
  const [inviteErrorDismissed, setInviteErrorDismissed] = useState(false);

  return (
    <div
      className="nu-shell"
      data-nu-role="app-shell"
      // Below the responsive breakpoint (styles/base/shell.css) the shell shows one "screen" at
      // a time instead of all four columns side by side — these two attributes are what the
      // media query switches on. They're no-ops above the breakpoint.
      data-nu-mobile-pane={mobileSpacesOpen ? 'spaces' : mainPaneHasContent ? 'chat' : 'sidebar'}
      data-nu-mobile-members-open={mobileMembersOpen}
      data-nu-music={musicOn ? 'on' : undefined}
      data-nu-ticker={tickerOn ? 'on' : undefined}
      // The global feed's own side column (FeedSidebar) takes the member list's place.
      data-nu-side={globalFeedOpen && !profileOpen && !postOpen ? 'feed' : undefined}
      data-nu-members-hidden={membersHidden || onHome || !selectedRoomId || globalFeedOpen || profileOpen || postOpen || spaceView !== null}
    >
      <Wallpaper />
      <StatusClock />
      <VoiceCallSession>
        <ServerRail />
        <ChannelList />
        <MainPane />
        <MemberList />
        {globalFeedOpen && !profileOpen && !postOpen && <FeedSidebar />}
      </VoiceCallSession>
      {mobileMembersOpen && (
        <div
          className="nu-shell__mobile-backdrop"
          data-nu-role="mobile-member-list-backdrop"
          onClick={() => setMobileMembersOpen(false)}
        />
      )}
      {tickerOn && <NotificationTicker />}
      <MobileTabBar />
      <MusicPlayerHost />
      <MusicPlayerBar variant="mini" />
      {/* Not over a chat, where it covered the composer: on the channel list. */}
      {isDemoMode() ? <DemoModeBanner /> : !mainPaneHasContent && <InstallHint />}
      <DesktopNotifications />
      <AppBadge />
      {!isDemoMode() && <AutoAway />}
      <NotificationRules />
      {/* Writes power levels and kicks; the demo's sample world has nothing it should change. */}
      {!isDemoMode() && <FeedGovernance />}
      {!isDemoMode() && <ChannelGovernance />}
      {!isDemoMode() && <ModerationWatcher />}
      {!isDemoMode() && <HistoryPrefetch />}
      <ReminderWatcher />
      <CommissionAlerts />
      <MentionInboxCollector />
      <ActivityWatcher />
      <MentionInviteAcceptor />
      <SpaceAutoJoiner />
      {/* Joins a server-wide room; the demo's sample world has none. */}
      {!isDemoMode() && <EmoteLibraryWatcher />}
      {!isDemoMode() && <FollowPublisher />}
      <IncomingVerificationListener />
      {/* For someone new, after the recovery key is dealt with (features/onboarding/). */}
      {!isDemoMode() && <WelcomeGuideHost blocked={recoveryStatus === 'needed' && !recoveryResolved} />}
      {recoveryStatus === 'needed' && !recoveryResolved && (
        <RecoveryKeyPrompt onResolved={() => setRecoveryResolved(true)} />
      )}
      {inviteLinkJoin.status === 'error' && !inviteErrorDismissed && (
        <div className="nu-invite-link-banner" data-nu-role="invite-link-error">
          Couldn't join from that invite link: {inviteLinkJoin.message}
          <button
            type="button"
            className="nu-invite-link-banner__dismiss"
            onClick={() => setInviteErrorDismissed(true)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
