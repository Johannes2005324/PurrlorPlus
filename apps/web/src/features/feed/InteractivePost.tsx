import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { MatrixEvent } from 'matrix-js-sdk';
import { openPostAtom } from '../../app/state/selection';
import { useConfirm } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useAutoGrow } from '../../components/useAutoGrow';
import { Menu, MenuItem } from '../../components/Menu';
import { shareLink } from '../../components/ShareLinkButton';
import { postLink } from '../../matrix/publicWeb';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { nameColorStyle, useNameColor } from '../../matrix/nameColor';
import { nameHue } from '../../components/Avatar';
import {
  buildPostContent,
  deletePost,
  editPost,
  POST_EVENT_TYPE,
  readFeedMarker,
  repostOfComment,
  type PostContent,
  type PostOrigin,
  type RepostOf,
} from '../../matrix/feed';
import type { FeedSource } from '../../matrix/globalFeed';
import { COMMENT_EVENT_TYPE, type MyRepost, type PostComment } from '../../matrix/postInteractions';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { canModerateFeed, isRemovedFromSpace } from '../../matrix/feedGovernance';
import { useWithLibraryEmotes } from '../../matrix/hooks/useEmoteLibrary';
import { useIgnoredUsers } from '../../matrix/hooks/useIgnoredUsers';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { usePostInteractions } from '../../matrix/hooks/usePostInteractions';
import { usePostMuted } from '../../matrix/hooks/usePostMuted';
import { forgetLike, recordLike } from '../../matrix/likedPosts';
import { repostToTarget, undoRepost } from '../../matrix/postPublishing';
import { CharCounter, isOverLimit } from './CharCounter';
import { CommentThread } from './CommentThread';
import { membersAsPeople } from '../messaging/useMentionAutocomplete';
import { PeopleListModal } from './PeopleListModal';
import { PostCard } from './PostCard';
import type { ComposerTarget } from './PostComposer';
import { ReportDialog } from './ReportDialog';
import { RepostDialog } from './RepostDialog';
import { GLOBAL_TARGET_ID } from './useComposerTargets';
import { useMyPinnedPost } from './usePinnedPost';

/** A timeline shows at most this many of a post's newest comments; the rest are on its page. */
export const INLINE_COMMENT_LIMIT = 3;

/** Why an action on a post you just made waits a moment (see `confirming` below). */
const STILL_POSTING = 'Still posting — try again in a moment.';

type InteractivePostProps = Omit<ComponentProps<typeof PostCard>, 'actions' | 'footer'> & {
  /** The feed room the post lives in, and its event ID — where likes and comments go. */
  roomId: string;
  postId: string;
  /** Where the post lives — carried to its own page, and to reposts. */
  sourceOrigin: PostOrigin;
  /** Whether that feed is world-readable (Global, a public Space). Comment media is uploaded
   *  plain there and encrypted everywhere else, matching the post's own media. */
  isPublic: boolean;
  /** Liking and commenting join the feed room, which only works where you're allowed in: any
   *  profile feed, but a Space's feeds only if you're in that Space. */
  canInteract: boolean;
  cannotInteractReason?: string;
  /** What reposting this post copies, and where it may go (repostTargetsFor) — absent when it
   *  can't be reposted anywhere you post. */
  repost?: { repostOf: RepostOf; targets: ComposerTarget[] };
  /** After a repost or quote lands in a feed the timeline may not have been reading yet. */
  onReposted?: (source: FeedSource) => void;
  /** Deletes the post, after asking. Only passed for the post's own author. */
  onDelete?: () => Promise<void>;
  /** More owner-only items for the ⋯ menu (Make private), as MenuItems. */
  extraMenuItems?: ReactNode;
  /** `timeline` (default): the thread opens on demand and shows only the newest few comments,
   *  linking to the post's page for the rest. `page`: the post's own page — the whole thread,
   *  always open. */
  mode?: 'timeline' | 'page';
};

/**
 * A post with its likes, comments and repost — the one card the Space Posts page, the global
 * feed, profiles and a post's own page all render, so they can't drift apart.
 */
export function InteractivePost({
  roomId,
  postId,
  sourceOrigin,
  isPublic,
  canInteract,
  cannotInteractReason,
  repost,
  onReposted,
  onDelete,
  extraMenuItems,
  mode = 'timeline',
  ...card
}: InteractivePostProps) {
  const mx = useMatrixClient();
  // The author's name in their own chosen color, as in chat (or the one picked from their name).
  const chosenColor = useNameColor(card.author.userId);
  const authorColor = nameColorStyle(chosenColor ?? `hsl(${nameHue(card.author.name)}, 70%, 78%)`);
  // A post you just made has a temporary "~" ID until the server confirms it (a moment). Anything
  // that points at it — an edit, a delete, a like, a comment, a pin — waits for the real one:
  // matrix-js-sdk throws on a temporary ID ("Cannot call getPendingEvents…"). The feed swaps the
  // ID in when it's confirmed (useGlobalFeed.ts), and these work again.
  const confirming = postId.startsWith('~');
  // Only a feed's owner posts in it, so the post's author is the feed's owner.
  const interactions = usePostInteractions(roomId, postId, card.author.userId, card.ts, { fresh: mode === 'page' });
  const setOpenPost = useSetAtom(openPostAtom);
  const onPage = mode === 'page';
  const [open, setOpen] = useState(onPage);
  const [error, setError] = useState<string>();
  // Why Like/Report did nothing — shown in the card, since a tooltip never shows on a phone.
  const [notice, setNotice] = useState<string>();
  // "Link copied", for a moment.
  const [linkNotice, setLinkNotice] = useState<string>();
  useEffect(() => {
    if (!linkNotice) return;
    const timer = setTimeout(() => setLinkNotice(undefined), 3000);
    return () => clearTimeout(timer);
  }, [linkNotice]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [reporting, setReporting] = useState<{ eventId: string; what: 'post' | 'comment' }>();

  /**
   * What reaching the Space's moderators needs (ReportDialog): the reported event and the Space its
   * feed belongs to. Only a Space's own feed has moderators; a profile feed has none. The event is
   * the loaded one when the feed room has it, else built from what the card already shows.
   */
  const reportedEventAndSpace = ({ eventId, what }: { eventId: string; what: 'post' | 'comment' }) => {
    const room = mx.getRoom(roomId);
    const marker = room ? readFeedMarker(room) : undefined;
    const space = marker?.spaceId && !marker.profile ? mx.getRoom(marker.spaceId) : undefined;
    if (!space) return {};
    const loaded = room?.findEventById(eventId);
    if (loaded) return { event: loaded, space };
    const comment = what === 'comment' ? interactions.comments.find((c) => c.eventId === eventId) : undefined;
    const sender = what === 'post' ? card.author.userId : comment?.sender;
    if (!sender) return { space };
    const body = what === 'post' ? card.content.body : (comment?.content.body ?? '');
    const event = new MatrixEvent({
      type: what === 'post' ? POST_EVENT_TYPE : COMMENT_EVENT_TYPE,
      room_id: roomId,
      event_id: eventId,
      sender,
      content: { body },
    });
    return { event, space };
  };
  // Quoting the post (true), or one of its comments (that comment's copy).
  const [quoting, setQuoting] = useState<boolean | RepostOf>(false);
  const [reposting, setReposting] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const { displayName } = useOwnProfile();
  const { pinned, pin } = useMyPinnedPost();
  const notifications = usePostMuted(roomId, postId);
  const liked = !!interactions.myLikeId;
  const reposted = !!interactions.myRepost;
  const isPostOwner = card.author.userId === card.myUserId;
  // A Space moderator, mirrored into this feed by its owner (feedGovernance.ts).
  const canModerate = !isPostOwner && canModerateFeed(mx.getRoom(roomId), card.myUserId);
  // Someone who has left or been removed from the Space stops showing here at once, even before
  // the feed's owner comes online and removes them from the feed room itself.
  const space = sourceOrigin.kind === 'space' ? mx.getRoom(sourceOrigin.spaceId) : null;
  const ignored = useIgnoredUsers();
  const comments = interactions.comments.filter(
    (comment) => !isRemovedFromSpace(space, comment.sender) && !ignored.has(comment.sender)
  );
  const commentCount = comments.length > 0 ? `${comments.length}${interactions.older ? '+' : ''}` : '';

  // Editing (the author only). What was saved shows at once, until the feed itself catches up:
  // a post's own page holds a snapshot, and a feed you haven't joined doesn't update live.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(editInputRef, draft);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saved, setSaved] = useState<PostContent>();
  const editEmotes = useWithLibraryEmotes(card.emotes ?? []);
  useEffect(() => setSaved(undefined), [card.content.body]);
  const content = saved ?? card.content;
  const edited = !!card.edited || !!saved;

  const handleSaveEdit = async (evt: FormEvent) => {
    evt.preventDefault();
    const body = draft.trim();
    if (savingEdit || isOverLimit(body) || (!body && !content.attachments?.length && !content.repostOf)) return;
    if (confirming) {
      setError(STILL_POSTING);
      return;
    }
    setSavingEdit(true);
    setError(undefined);
    try {
      const { formattedBody } = buildMessageFormatting(body, editEmotes, []);
      const next = buildPostContent(body, formattedBody, {
        attachments: content.attachments,
        repostOf: content.repostOf,
        warning: content.warning,
        sensitive: content.sensitive,
      });
      await editPost(mx, roomId, postId, next);
      setSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that edit');
    } finally {
      setSavingEdit(false);
    }
  };

  const editForm = editing ? (
    <form className="nu-post__edit" data-nu-role="post-edit-form" onSubmit={handleSaveEdit}>
      <textarea
        ref={editInputRef}
        className="nu-field__textarea nu-post__edit-input"
        data-nu-role="post-edit-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        rows={3}
        autoFocus
      />
      <div className="nu-form-actions">
        <CharCounter text={draft} />
        <button type="button" className="nu-button nu-button--secondary" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="submit"
          className="nu-button nu-button--primary"
          data-nu-role="post-edit-save"
          disabled={savingEdit || isOverLimit(draft)}
        >
          {savingEdit ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  ) : undefined;

  const handleRemove = async () => {
    const ok = await confirm({
      title: 'Remove post',
      message: `Remove ${card.author.name}’s post for everyone? This can’t be undone.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setError(undefined);
    try {
      await deletePost(mx, roomId, postId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t remove that post');
    }
  };

  const openPage = () =>
    setOpenPost({
      roomId,
      postId,
      isPublic,
      canInteract,
      cannotInteractReason,
      content,
      edited,
      author: card.author,
      ts: card.ts,
      sourceOrigin,
      showOrigin: !!card.origin,
      emotes: card.emotes,
      members: card.members,
    });

  const handleDelete = async () => {
    if (!onDelete) return;
    if (confirming) {
      setNotice(STILL_POSTING);
      return;
    }
    const ok = await confirm({
      title: 'Delete post',
      message: 'Delete this post for everyone? Its likes and comments go with it. This can’t be undone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setError(undefined);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete that post');
    }
  };

  const handleLike = async () => {
    if (!canInteract) {
      setNotice(cannotInteractReason);
      return;
    }
    if (confirming) {
      setNotice(STILL_POSTING);
      return;
    }
    setError(undefined);
    const wasLiked = liked;
    try {
      await interactions.toggleLike();
      // Filed for your profile's Likes tab (likedPosts.ts). Best-effort: the like itself stands.
      const record = wasLiked
        ? forgetLike(mx, postId)
        : recordLike(mx, {
            roomId,
            eventId: postId,
            owner: card.author.userId,
            ownerName: card.author.name,
            origin: sourceOrigin,
            isPublic,
          });
      void record.catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t update that like');
    }
  };

  // A plain repost goes out at once — to Global when that's allowed, otherwise the one place it
  // may go (the post's own Space). Quote is the dialog, for adding words or picking a place.
  const handleRepost = async () => {
    if (!repost || reposting) return;
    if (confirming) {
      setNotice(STILL_POSTING);
      return;
    }
    const target = repost.targets.find((t) => t.id === GLOBAL_TARGET_ID) ?? repost.targets[0];
    if (!target) return;
    setReposting(true);
    setError(undefined);
    try {
      const { source } = await repostToTarget(mx, target.target, repost.repostOf, displayName || card.myUserId, target.isPublic);
      onReposted?.(source);
      await interactions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t repost that');
    } finally {
      setReposting(false);
    }
  };

  const handleUndoRepost = async () => {
    if (!interactions.myRepost || reposting) return;
    setReposting(true);
    setError(undefined);
    try {
      await undoRepost(mx, roomId, interactions.myRepost);
      await interactions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t undo that repost');
    } finally {
      setReposting(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!canInteract) {
      setNotice(cannotInteractReason);
      return;
    }
    setError(undefined);
    try {
      await interactions.toggleCommentLike(commentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t update that like');
    }
  };

  const commentCopy = (comment: PostComment, authorName: string) =>
    repostOfComment(
      { roomId, eventId: postId, sender: card.author.userId, origin: sourceOrigin },
      { eventId: comment.eventId, sender: comment.sender, senderName: authorName, ts: comment.ts, content: comment.content }
    );

  // A comment reposts to the same places its post may go, the same way: at once, or quoted.
  const handleRepostComment = async (comment: PostComment, authorName: string) => {
    if (!repost || reposting) return;
    const target = repost.targets.find((t) => t.id === GLOBAL_TARGET_ID) ?? repost.targets[0];
    if (!target) return;
    setReposting(true);
    setError(undefined);
    try {
      const { source } = await repostToTarget(mx, target.target, commentCopy(comment, authorName), displayName || card.myUserId, target.isPublic);
      onReposted?.(source);
      await interactions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t repost that');
    } finally {
      setReposting(false);
    }
  };

  const handleUndoCommentRepost = async (mine: MyRepost) => {
    if (reposting) return;
    setReposting(true);
    setError(undefined);
    try {
      await undoRepost(mx, roomId, mine);
      await interactions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t undo that repost');
    } finally {
      setReposting(false);
    }
  };

  const renderCommentRepost = (comment: PostComment, authorName: string) => {
    const stats = interactions.commentStats[comment.eventId];
    const mine = stats?.myRepost;
    if (!repost && !mine) return null;
    const count = stats?.repostCount ?? 0;
    return (
      <Menu
        label={mine ? 'Reposted' : 'Repost or quote'}
        role="post-comment-repost"
        align="end"
        triggerClassName={mine ? 'nu-post__action nu-post__action--reposted' : 'nu-post__action'}
        trigger={
          <>
            <Icon name="repost" size={12} />
            {count > 0 && count}
          </>
        }
      >
        {mine ? (
          <MenuItem icon="repost" role="post-comment-undo-repost" onSelect={() => void handleUndoCommentRepost(mine)}>
            Undo repost
          </MenuItem>
        ) : (
          <MenuItem icon="repost" role="post-comment-repost-now" onSelect={() => void handleRepostComment(comment, authorName)}>
            Repost
          </MenuItem>
        )}
        {repost && (
          <MenuItem icon="pencil" role="post-comment-quote" onSelect={() => setQuoting(commentCopy(comment, authorName))}>
            Quote
          </MenuItem>
        )}
      </Menu>
    );
  };

  const handleMute = async () => {
    setError(undefined);
    try {
      await notifications.toggle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t change this post’s notifications');
    }
  };

  // Only a post anyone can read can be pinned to your public profile.
  const canPin = isPostOwner && isPublic;
  const isPinned = pinned?.eventId === postId;
  // A Global post's link opens for anyone; a Space post's names its room and opens for members only.
  const handleCopyLink = async () => {
    const result = await shareLink(postLink(card.author.userId, postId, sourceOrigin.kind === 'space' ? roomId : undefined));
    if (result === 'copied') setLinkNotice(sourceOrigin.kind === 'global' ? 'Link copied.' : 'Link copied. Only members of the Space can open it.');
    else if (result === 'failed') setLinkNotice('Couldn’t copy the link.');
  };

  const handlePin = async () => {
    if (confirming) {
      setNotice(STILL_POSTING);
      return;
    }
    setError(undefined);
    try {
      await pin(isPinned ? null : { roomId, eventId: postId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t update your pinned post');
    }
  };

  const countLabel = (count: number, truncated: boolean) => `${count}${truncated ? '+' : ''}`;

  // Someone you've blocked: their posts go, wherever they're read from.
  if (ignored.has(card.author.userId)) return null;

  return (
    <PostCard
      {...card}
      authorColor={authorColor}
      content={content}
      edited={edited}
      bodyOverride={editForm}
      onOpen={onPage ? undefined : openPage}
      actions={
        <>
          <button
            type="button"
            className={[
              'nu-post__action',
              liked && 'nu-post__action--active',
              !canInteract && 'nu-post__action--unavailable',
            ]
              .filter(Boolean)
              .join(' ')}
            data-nu-role="post-like"
            aria-pressed={liked}
            aria-disabled={!canInteract}
            title={canInteract ? (liked ? 'Unlike' : 'Like') : cannotInteractReason}
            disabled={interactions.busy}
            onClick={() => void handleLike()}
          >
            <Icon name="heart" size={14} filled={liked} />
            {/* The word and the count, "Like 24", as on the Ultimit feed. */}
            Like{interactions.likeCount > 0 && <span className="nu-post__action-count">{countLabel(interactions.likeCount, interactions.likesTruncated)}</span>}
          </button>
          <button
            type="button"
            className={open ? 'nu-post__action nu-post__action--active' : 'nu-post__action'}
            data-nu-role="post-comment-toggle"
            aria-expanded={open}
            // On the post's page the thread is the page; there's nothing to toggle.
            disabled={onPage}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="comment" size={14} />
            Comment{commentCount && <span className="nu-post__action-count">{commentCount}</span>}
          </button>
          {(repost || reposted) && (
            <Menu
              label={reposted ? 'Reposted' : 'Repost or quote'}
              role="post-repost-action"
              triggerClassName={reposted ? 'nu-post__action nu-post__action--reposted' : 'nu-post__action'}
              trigger={
                <>
                  <Icon name="repost" size={14} />
                  {reposted ? 'Reposted' : 'Repost'}
                  {interactions.repostCount > 0 && (
                    <span className="nu-post__action-count">{countLabel(interactions.repostCount, interactions.repostsTruncated)}</span>
                  )}
                </>
              }
            >
              {reposted ? (
                <MenuItem icon="repost" role="post-undo-repost" onSelect={() => void handleUndoRepost()}>
                  Undo repost
                </MenuItem>
              ) : (
                <MenuItem icon="repost" role="post-repost-now" onSelect={() => void handleRepost()}>
                  Repost
                </MenuItem>
              )}
              {repost && (
                <MenuItem icon="pencil" role="post-quote" onSelect={() => setQuoting(true)}>
                  Quote
                </MenuItem>
              )}
            </Menu>
          )}
          <Menu
            label="More"
            role="post-more"
            align="end"
            triggerClassName="nu-post__action nu-post__action--more"
            trigger={<Icon name="more" size={16} />}
          >
            {isPostOwner && !editing && (
              <MenuItem
                icon="pencil"
                role="post-edit"
                onSelect={() => {
                  setDraft(content.body);
                  setEditing(true);
                }}
              >
                Edit
              </MenuItem>
            )}
            {canPin && (
              <MenuItem icon="pin" role="post-pin" onSelect={() => void handlePin()}>
                {isPinned ? 'Unpin from profile' : 'Pin to profile'}
              </MenuItem>
            )}
            <MenuItem icon="link" role="post-copy-link" onSelect={() => void handleCopyLink()}>
              {sourceOrigin.kind === 'global' ? 'Copy link' : 'Copy link (members only)'}
            </MenuItem>
            {extraMenuItems}
            {/* Anyone can mute a post: its author, or someone getting its thread replies. */}
            <MenuItem icon={notifications.muted ? 'bell' : 'bellOff'} role="post-mute" onSelect={() => void handleMute()}>
              {notifications.muted ? 'Unmute notifications' : 'Mute notifications'}
            </MenuItem>
            {interactions.likeCount > 0 && (
              <MenuItem icon="heart" role="post-likers" onSelect={() => setShowLikers(true)}>
                See who liked
              </MenuItem>
            )}
            {!isPostOwner && (
              <MenuItem
                icon="flag"
                role="post-report"
                onSelect={() => (canInteract ? setReporting({ eventId: postId, what: 'post' }) : setNotice(cannotInteractReason))}
              >
                Report post
              </MenuItem>
            )}
            {canModerate && (
              <MenuItem icon="shield" role="post-moderator-remove" danger onSelect={() => void handleRemove()}>
                Remove (moderator)
              </MenuItem>
            )}
            {onDelete && (
              <MenuItem icon="trash" role="feed-post-delete" danger onSelect={() => void handleDelete()}>
                Delete
              </MenuItem>
            )}
          </Menu>
        </>
      }
      footer={
        <>
          {confirmDialog}
          {onPage && (interactions.likeCount > 0 || interactions.repostCount > 0) && (
            <p className="nu-post__stats" data-nu-role="post-stats">
              {interactions.likeCount > 0 && (
                <button type="button" className="nu-post__stat" data-nu-role="post-stats-likes" onClick={() => setShowLikers(true)}>
                  <strong>{countLabel(interactions.likeCount, interactions.likesTruncated)}</strong>{' '}
                  {interactions.likeCount === 1 ? 'like' : 'likes'}
                </button>
              )}
              {interactions.repostCount > 0 && (
                <span className="nu-post__stat">
                  <strong>{countLabel(interactions.repostCount, interactions.repostsTruncated)}</strong>{' '}
                  {interactions.repostCount === 1 ? 'repost' : 'reposts'}
                </span>
              )}
            </p>
          )}
          {showLikers && (
            <PeopleListModal
              title="Liked by"
              userIds={interactions.likers}
              emptyText="Nobody has liked this yet."
              {...(interactions.likesTruncated && { note: `Showing the first ${interactions.likers.length}.` })}
              onClose={() => setShowLikers(false)}
            />
          )}
          {quoting && repost && (
            <RepostDialog
              repostOf={quoting === true ? repost.repostOf : quoting}
              targets={repost.targets}
              onClose={() => setQuoting(false)}
              onReposted={(source) => {
                onReposted?.(source);
                void interactions.reload();
              }}
            />
          )}
          {notice && (
            <p className="nu-post__notice" data-nu-role="post-interaction-notice">
              {notice}
            </p>
          )}
          {linkNotice && (
            <p className="nu-post__notice" data-nu-role="post-link-notice" role="status">
              {linkNotice}
            </p>
          )}
          {reporting && (
            <ReportDialog
              roomId={roomId}
              eventId={reporting.eventId}
              what={reporting.what}
              ownerId={card.author.userId}
              postId={postId}
              {...reportedEventAndSpace(reporting)}
              onClose={() => setReporting(undefined)}
            />
          )}
          {error && (
            <p className="nu-field__error" data-nu-role="post-interaction-error">
              {error}
            </p>
          )}
          {open && (
            <CommentThread
              comments={comments}
              isPublic={isPublic}
              canComment={canInteract}
              cannotCommentReason={cannotInteractReason}
              canRemoveAny={isPostOwner || canModerate}
              // Only people in the feed room receive its events, so only they can be mentioned.
              mentionPeople={membersAsPeople(mx.getRoom(roomId)?.getJoinedMembers() ?? []).filter(
                (person) => person.userId !== card.myUserId && !ignored.has(person.userId)
              )}
              {...(canInteract && { onReport: (eventId: string) => setReporting({ eventId, what: 'comment' }) })}
              onOpenProfile={card.onOpenProfile}
              emotes={card.emotes}
              members={card.members}
              onAdd={
                confirming
                  ? () => Promise.reject(new Error(STILL_POSTING))
                  : interactions.addComment
              }
              onDelete={interactions.removeComment}
              hasOlder={!!interactions.older}
              loadingOlder={interactions.loadingOlder}
              onLoadOlder={interactions.loadOlder}
              commentStats={interactions.commentStats}
              onLikeComment={(commentId) => void handleLikeComment(commentId)}
              renderRepost={renderCommentRepost}
              {...(!onPage && { inlineLimit: INLINE_COMMENT_LIMIT, onViewAll: openPage, totalLabel: commentCount })}
            />
          )}
        </>
      }
    />
  );
}
