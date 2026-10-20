import type { ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { composerFocusAtom, feedSearchAtom } from '../../app/state/feed';
import { openPostAtom, profileUserIdAtom, socialSpaceIdAtom, socialViewAtom, type SocialView } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { UnreadBadge } from '../../components/UnreadBadge';
import { useHasNewPosts } from '../../matrix/hooks/useHasNewPosts';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { useOpenSocial, useOpenSocialSpace } from './useOpenSocial';

function NavRow({
  active,
  role,
  icon,
  label,
  badge,
  unread = false,
  onSelect,
}: {
  active: boolean;
  role: string;
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
  unread?: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="nu-channel-list__row">
      <button
        type="button"
        className={['nu-channel-list__item', active && 'nu-channel-list__item--active', unread && 'nu-channel-list__item--unread']
          .filter(Boolean)
          .join(' ')}
        data-nu-role={role}
        aria-current={active ? 'page' : undefined}
        onClick={onSelect}
      >
        <span className="nu-channel-list__item-icon" aria-hidden="true">
          {icon}
        </span>
        <span className={unread ? 'nu-channel-list__item-name nu-channel-list__item-name--unread' : 'nu-channel-list__item-name'}>
          {label}
        </span>
        {badge}
      </button>
    </div>
  );
}

/** A Space's Posts, with the same "someone posted since you looked" dot as in its channel list. It
 *  opens in the main pane and leaves the sidebar where it is. */
function SpacePostsRow({ space, active }: { space: Room; active: boolean }) {
  const newPosts = useHasNewPosts(space);
  const openSpace = useOpenSocialSpace();
  return (
    <NavRow
      active={active}
      role="social-nav-space-posts"
      icon={<Avatar name={space.name} mxcUrl={space.getMxcAvatarUrl() ?? undefined} size={20} />}
      label={space.name}
      unread={newPosts}
      badge={<UnreadBadge total={newPosts ? 1 : 0} highlight={0} />}
      onSelect={() => openSpace(space.roomId)}
    />
  );
}

const VIEWS: { view: SocialView; label: string; icon: IconName }[] = [
  { view: 'everyone', label: 'Everyone', icon: 'globe' },
  { view: 'following', label: 'Following', icon: 'users' },
];

/**
 * The channel list's column while the social side is open: its own places (the two timelines,
 * Notifications, your profile) and each of your Spaces' Posts, in place of a Direct messages list
 * that has nothing to do with the feed. Rows are the channel list's own, so it reads as the same
 * app. On a phone the column is off screen while the feed shows, so the feed's header keeps tabs.
 */
export function SocialNav() {
  const view = useAtomValue(socialViewAtom);
  const profileUserId = useAtomValue(profileUserIdAtom);
  const postOpen = !!useAtomValue(openPostAtom);
  const socialSpaceId = useAtomValue(socialSpaceIdAtom);
  const spaces = useSpaces();
  const openSocial = useOpenSocial();
  const setSearch = useSetAtom(feedSearchAtom);
  const requestComposerFocus = useSetAtom(composerFocusAtom);
  // A profile or a post's page sits over the timeline; the row for what's underneath isn't where you are.
  const onPage = !profileUserId && !postOpen;

  return (
    <>
      <div className="nu-channel-list__header" data-nu-role="social-nav-header">
        <span className="nu-channel-list__header-title">Feed</span>
        <button
          type="button"
          className="nu-channel-list__header-action"
          data-nu-role="social-nav-new-post"
          title="New post (N)"
          aria-label="New post"
          onClick={() => {
            // Same as the N shortcut: to the timeline, out of any search, composer focused.
            openSocial(view === 'notifications' ? 'everyone' : view);
            setSearch('');
            requestComposerFocus((n) => n + 1);
          }}
        >
          <Icon name="pencil" size={16} />
        </button>
      </div>
      <div className="nu-channel-list__body" data-nu-role="social-nav">
        {VIEWS.map((item) => (
          <NavRow
            key={item.view}
            active={onPage && !socialSpaceId && view === item.view}
            role={`social-nav-${item.view}`}
            icon={<Icon name={item.icon} size={18} />}
            label={item.label}
            onSelect={() => openSocial(item.view)}
          />
        ))}
        {spaces.length > 0 && (
          <div className="nu-channel-list__category" data-nu-role="social-nav-spaces">
            <div className="nu-channel-list__section-header">Posts in your spaces</div>
            {spaces.map((space) => (
              <SpacePostsRow key={space.roomId} space={space} active={onPage && socialSpaceId === space.roomId} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
