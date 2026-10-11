import { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { activityAtom } from '../../app/state/feed';
import {
  globalFeedOpenAtom,
  pendingJumpTargetAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { isUnread, markActivitySeen, type ActivityItem, type ActivityKind } from '../../matrix/activity';
import { readPostContent } from '../../matrix/feed';
import { useUserProfile } from '../../matrix/hooks/useUserProfile';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import { InvitesWaiting } from '../invites/InvitesWaiting';
import { formatPostTime } from './formatPostTime';
import { useOpenPost } from './useOpenPost';
import './ActivityView.css';

const ICONS: Record<ActivityKind, IconName> = {
  like: 'heart',
  repost: 'repost',
  quote: 'repost',
  comment: 'comment',
  reply: 'reply',
  thread: 'threads',
  commentLike: 'heart',
  mention: 'at',
  follow: 'userPlus',
};

/** What each kind of notification says after the name: the ticker (NotificationTicker.tsx) uses it too. */
export const VERBS: Record<ActivityKind, string> = {
  like: 'liked your post',
  repost: 'reposted your post',
  quote: 'quoted your post',
  comment: 'commented on your post',
  reply: 'replied to you',
  thread: 'replied in a thread you’re in',
  commentLike: 'liked your comment',
  mention: 'mentioned you',
  follow: 'followed you',
};

/** A snippet is plain text: the markdown a post was written in (`**bold**`, `||spoiler||`) shows as
 *  the words, not the marks. A spoiler stays hidden. */
function plainSnippet(body: string): string {
  return body
    .replace(/\|\|[\s\S]*?\|\|/g, '▒▒▒')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()<>"]+)\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim();
}

// A post's or comment's text, read once per session — rows re-render often, the text doesn't
// change (an edit shows on the post itself).
const textCache = new Map<string, Promise<string | undefined>>();

function readEventText(mx: MatrixClient, roomId: string, eventId: string): Promise<string | undefined> {
  const key = `${roomId}|${eventId}`;
  let cached = textCache.get(key);
  if (!cached) {
    const local = mx.getRoom(roomId)?.findEventById(eventId);
    cached = (local ? Promise.resolve(local.getContent()) : mx.fetchRoomEvent(roomId, eventId).then((raw) => raw.content ?? {}))
      .then((content) => {
        const post = readPostContent(content as Record<string, unknown>);
        if (!post) return undefined;
        return post.warning ? `CW: ${post.warning}` : plainSnippet(post.body) || (post.attachments?.length ? '📷 Media' : undefined);
      })
      .catch(() => undefined);
    textCache.set(key, cached);
  }
  return cached;
}

function useEventText(roomId: string, eventId: string | undefined): string | undefined {
  const mx = useMatrixClient();
  const [text, setText] = useState<string>();
  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;
    void readEventText(mx, roomId, eventId).then((t) => {
      if (!cancelled) setText(t);
    });
    return () => {
      cancelled = true;
    };
  }, [mx, roomId, eventId]);
  return text;
}

/** Where a chat mention was: "#general" for a Space's channel, the name for a DM or group. */
function ChatPlace({ roomId }: { roomId: string }) {
  const mx = useMatrixClient();
  const room = mx.getRoom(roomId);
  if (!room) return <>a channel you’ve left</>;
  return <strong>{findParentSpaceId(mx, roomId) ? `#${room.name}` : room.name}</strong>;
}

function SenderName({ userId }: { userId: string }) {
  return <strong>{useUserProfile(userId).name}</strong>;
}

/** "Ana", "Ana and Bo", "Ana and 3 others". */
function Who({ senders }: { senders: string[] }) {
  if (senders.length === 1) return <SenderName userId={senders[0]} />;
  if (senders.length === 2) {
    return (
      <>
        <SenderName userId={senders[0]} /> and <SenderName userId={senders[1]} />
      </>
    );
  }
  return (
    <>
      <SenderName userId={senders[0]} /> and {senders.length - 1} others
    </>
  );
}

/** What a row quotes: the words themselves for a comment, reply, mention or quote; your own post
 *  for a like or repost; nothing for a follow. */
function snippetTarget(item: ActivityItem): { roomId: string; eventId?: string } {
  switch (item.kind) {
    case 'comment':
    case 'reply':
    case 'thread':
    case 'mention':
      return { roomId: item.roomId, eventId: item.eventId };
    case 'commentLike':
      return { roomId: item.roomId, eventId: item.commentId };
    case 'quote':
      return item.quote ?? { roomId: item.roomId, eventId: item.postId };
    case 'like':
    case 'repost':
      return { roomId: item.roomId, eventId: item.postId };
    default:
      return { roomId: item.roomId };
  }
}

function ActivityRow({ item, unread }: { item: ActivityItem; unread: boolean }) {
  const first = useUserProfile(item.senders[0]);
  const target = snippetTarget(item);
  const text = useEventText(target.roomId, target.eventId);
  const openPost = useOpenPost();
  const mx = useMatrixClient();
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const setGlobalFeedOpen = useSetAtom(globalFeedOpenAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setPendingJump = useSetAtom(pendingJumpTargetAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const quiet = item.kind === 'like' || item.kind === 'commentLike' || item.kind === 'repost';
  // A mention in a channel or DM rather than in a post: it opens at the message.
  const inChat = item.kind === 'mention' && !item.postId;

  const open = () => {
    if (inChat) {
      setGlobalFeedOpen(false);
      setSpaceView(null);
      setSelectedSpaceId(findParentSpaceId(mx, item.roomId));
      setSelectedRoomId(item.roomId);
      setPendingJump({ roomId: item.roomId, eventId: item.eventId });
    } else if (item.kind === 'follow') {
      setProfileUserId(item.senders[0]);
    } else if (item.kind === 'quote' && item.quote) {
      // The quote lives in the quoter's feed, which you may not be in; fall back to your post.
      void openPost(item.quote.roomId, item.quote.eventId).then((opened) => {
        if (!opened && item.postId) void openPost(item.roomId, item.postId);
      });
    } else if (item.postId) {
      void openPost(item.roomId, item.postId);
    }
  };

  return (
    <li>
      <button
        type="button"
        className={unread ? 'nu-activity__row nu-activity__row--unread' : 'nu-activity__row'}
        data-nu-role="activity-row"
        data-nu-kind={item.kind}
        data-nu-chat={inChat || undefined}
        disabled={inChat && !mx.getRoom(item.roomId)}
        onClick={open}
      >
        {/* Laid out like a chat message — who on the left, what they said beside it — with what
            kind of thing it is as a badge on the avatar. */}
        <span className="nu-activity__avatar">
          <Avatar name={first.name} mxcUrl={first.avatarUrl} size={36} />
          <span className={`nu-activity__icon nu-activity__icon--${item.kind}`} aria-hidden="true">
            <Icon name={ICONS[item.kind]} size={11} filled={item.kind === 'like' || item.kind === 'commentLike'} />
          </span>
        </span>
        <span className="nu-activity__body">
          <span className="nu-activity__head">
            <span className="nu-activity__summary">
              <Who senders={item.senders} /> {VERBS[item.kind]}
              {inChat && (
                <>
                  {' '}
                  in <ChatPlace roomId={item.roomId} />
                </>
              )}
            </span>
            <time className="nu-activity__time" dateTime={new Date(item.ts).toISOString()} title={new Date(item.ts).toLocaleString()}>
              {formatPostTime(item.ts)}
            </time>
          </span>
          {text && <span className={quiet ? 'nu-activity__text nu-activity__text--quiet' : 'nu-activity__text'}>{text}</span>}
        </span>
      </button>
    </li>
  );
}

type Filter = 'all' | 'mentions';

const isMention = (item: ActivityItem) => item.kind === 'mention' || item.kind === 'reply' || item.kind === 'thread';

/**
 * The Notifications page (Activity in the code): what people did with your posts and profile, and
 * every mention of you — in a post, a comment or a channel — newest first. Opening it marks
 * everything seen (on every device); what was new when you opened it stays highlighted while
 * you're looking.
 */
export function ActivityView() {
  const mx = useMatrixClient();
  const { items: all, loaded, seenTs } = useAtomValue(activityAtom);
  const [filter, setFilter] = useState<Filter>('all');
  const items = filter === 'mentions' ? all.filter(isMention) : all;
  // Captured once, so rows don't lose their highlight the instant they're marked seen.
  const [seenAtOpen] = useState(seenTs);
  const newest = all[0]?.ts ?? 0;

  useEffect(() => {
    if (newest > 0) void markActivitySeen(mx, newest).catch(() => undefined);
  }, [mx, newest]);

  if (!loaded) {
    return (
      <p className="nu-feed__status" data-nu-role="activity-loading">
        Checking for notifications…
      </p>
    );
  }

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={filter === value}
      className={filter === value ? 'nu-feed__tab nu-feed__tab--active' : 'nu-feed__tab'}
      data-nu-role={`activity-filter-${value}`}
      onClick={() => setFilter(value)}
    >
      {label}
    </button>
  );

  return (
    <>
      <InvitesWaiting />
      <div className="nu-activity__filters">
        <div className="nu-feed__tabs" role="tablist" aria-label="Show">
          {filterButton('all', 'All')}
          {filterButton('mentions', 'Mentions')}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="nu-feed__status" data-nu-role="activity-empty">
          {filter === 'mentions'
            ? 'No mentions yet. When someone @-mentions you in a channel, a post or a comment, it shows up here.'
            : 'Nothing yet. When people mention you, like, comment on, repost or quote your posts, or follow you, it shows up here.'}
        </p>
      ) : (
        <ul className="nu-activity" data-nu-role="activity-list">
          {items.map((item) => (
            <ActivityRow key={item.key} item={item} unread={isUnread(item, seenAtOpen)} />
          ))}
        </ul>
      )}
    </>
  );
}
