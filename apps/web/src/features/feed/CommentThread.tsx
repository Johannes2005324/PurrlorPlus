import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { useConfirm } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useAutoGrow } from '../../components/useAutoGrow';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useHiddenLibraryImages, useWithLibraryEmotes } from '../../matrix/hooks/useEmoteLibrary';
import { useUserProfile } from '../../matrix/hooks/useUserProfile';
import type { Emote } from '../../matrix/emotes';
import { buildPostContent, POST_MAX_LENGTH, postLength, type PostContent } from '../../matrix/feed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { ACCEPTED_MEDIA_TYPES } from '../../matrix/postMedia';
import type { CommentStats, PostComment, ReplyTarget } from '../../matrix/postInteractions';
import { renderMessageText } from '../messaging/renderMessageText';
import { useMentionAutocomplete, type MentionPerson } from '../messaging/useMentionAutocomplete';
import { CharCounter, isOverLimit } from './CharCounter';
import { formatPostTime } from './formatPostTime';
import { PostMedia } from './PostMedia';
import { renderPostMarkdown } from './renderPostMarkdown';
import { StagedMediaPreviews, useStagedMedia } from './useStagedMedia';
import './CommentThread.css';

/** On a post's own page: how many of the newest comments show at first, and how many more each
 *  "earlier" adds. */
const PAGE_INITIAL_VISIBLE = 50;
const REVEAL_STEP = 50;

function ReplyingToLabel({ userId, members, role }: { userId: string; members: RoomMember[]; role: string }) {
  const target = useUserProfile(userId, members);
  return (
    <span className="nu-comment__reply-to" data-nu-role={role}>
      <Icon name="reply" size={12} />
      Replying to <strong>{target.name}</strong>
    </span>
  );
}

function CommentItem({
  comment,
  myUserId,
  canDelete,
  canReply,
  emotes,
  members,
  onDelete,
  onReply,
  onReport,
  onOpenProfile,
  stats,
  onLike,
  renderRepost,
}: {
  comment: PostComment;
  myUserId: string;
  canDelete: boolean;
  canReply: boolean;
  emotes: Emote[];
  members: RoomMember[];
  onDelete: () => void;
  onReply: (target: ReplyTarget) => void;
  onReport?: () => void;
  onOpenProfile?: (userId: string) => void;
  stats?: CommentStats;
  onLike?: () => void;
  renderRepost?: (comment: PostComment, authorName: string) => ReactNode;
}) {
  const author = useUserProfile(comment.sender, members);
  const hiddenMxcUrls = useHiddenLibraryImages();
  const liked = !!stats?.myLikeId;
  const likeCount = stats?.likeCount ?? 0;
  return (
    <li className="nu-comment" data-nu-role="post-comment">
      <Avatar name={author.name} mxcUrl={author.avatarUrl} size={28} />
      <div className="nu-comment__body">
        <header className="nu-comment__meta">
          {onOpenProfile ? (
            <button
              type="button"
              className="nu-comment__author nu-comment__author--link"
              data-nu-role="post-comment-author"
              onClick={() => onOpenProfile(comment.sender)}
            >
              {author.name}
            </button>
          ) : (
            <span className="nu-comment__author">{author.name}</span>
          )}
          <time className="nu-post__time" dateTime={new Date(comment.ts).toISOString()} title={new Date(comment.ts).toLocaleString()}>
            {formatPostTime(comment.ts)}
          </time>
          <span className="nu-comment__actions">
            {onLike && (
              <button
                type="button"
                className={liked ? 'nu-post__action nu-post__action--active' : 'nu-post__action'}
                data-nu-role="post-comment-like"
                aria-pressed={liked}
                title={liked ? 'Unlike' : 'Like'}
                aria-label={liked ? 'Unlike' : 'Like'}
                onClick={onLike}
              >
                <Icon name="heart" size={12} filled={liked} />
                {likeCount > 0 && likeCount}
              </button>
            )}
            {renderRepost?.(comment, author.name)}
            {canReply && (
              <button
                type="button"
                className="nu-post__action"
                data-nu-role="post-comment-reply"
                onClick={() => onReply({ eventId: comment.eventId, sender: comment.sender })}
              >
                <Icon name="reply" size={12} />
                Reply
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="nu-post__action nu-post__action--danger"
                data-nu-role="post-comment-delete"
                title="Delete comment"
                aria-label="Delete comment"
                onClick={onDelete}
              >
                <Icon name="trash" size={12} />
              </button>
            )}
            {onReport && (
              <button
                type="button"
                className="nu-post__action"
                data-nu-role="post-comment-report"
                title="Report comment"
                aria-label="Report comment"
                onClick={onReport}
              >
                <Icon name="flag" size={12} />
              </button>
            )}
          </span>
        </header>
        {comment.replyTo && <ReplyingToLabel userId={comment.replyTo.sender} members={members} role="post-comment-reply-label" />}
        {comment.content.body && (
          <div className="nu-post__text">
            {renderPostMarkdown(comment.content.body, (text) =>
              renderMessageText(text, emotes, members, myUserId, {
                formattedBody: comment.content.formatted_body,
                hiddenMxcUrls,
              })
            )}
          </div>
        )}
        {comment.content.attachments && <PostMedia attachments={comment.content.attachments} />}
      </div>
    </li>
  );
}

/**
 * A post's comments, oldest first, and the box to add one — text, images and video, exactly like
 * a post. Media goes up encrypted unless the post lives somewhere public, so a comment's media is
 * as private as the post it's under (postMedia.ts). Any comment can be replied to; the reply
 * notifies that comment's author (postInteractions.ts).
 *
 * Two sizes. **In a timeline** (\`inlineLimit\` + \`onViewAll\`) it shows only the newest few, and a
 * longer thread is a "View all" link to the post's own page — so a thread of any length costs a
 * timeline the same few rows. **On the post page** it's the whole thread: the newest 50, then
 * "Show earlier comments" reveals ones already loaded and fetches older pages (onLoadOlder).
 */
export function CommentThread({
  comments,
  isPublic,
  canComment,
  cannotCommentReason,
  canRemoveAny,
  onReport,
  onOpenProfile,
  mentionPeople = [],
  emotes: placeEmotes = [],
  members = [],
  onAdd,
  onDelete,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  inlineLimit,
  onViewAll,
  totalLabel,
  commentStats = {},
  onLikeComment,
  renderRepost,
}: {
  /** Everything loaded so far, oldest first. */
  comments: PostComment[];
  /** Whether the post's feed is world-readable — decides plain vs encrypted media uploads. */
  isPublic: boolean;
  canComment: boolean;
  cannotCommentReason?: string;
  /** Can remove anyone's comment: the post's author in their own feed, or a Space moderator. */
  canRemoveAny: boolean;
  /** Reports someone else's comment to the server's admins. */
  onReport?: (commentId: string) => void;
  /** Opens a commenter's profile from their name. */
  onOpenProfile?: (userId: string) => void;
  /** Who can be @mentioned: whoever a mention here can reach (the feed room's members). */
  mentionPeople?: MentionPerson[];
  emotes?: Emote[];
  members?: RoomMember[];
  onAdd: (content: PostContent, replyTo?: ReplyTarget) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  /** Older comments exist on the server that aren't loaded yet. */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => Promise<void>;
  /** Timeline mode: show only this many of the newest, and link the rest to the post page. */
  inlineLimit?: number;
  onViewAll?: () => void;
  /** The comment count as the card shows it ("12", or "50+" while more are unloaded). */
  totalLabel?: string;
  /** Each comment's likes and reposts, by comment ID. */
  commentStats?: Record<string, CommentStats>;
  onLikeComment?: (commentId: string) => void;
  /** A comment's repost button, drawn by the post (which knows where it may be reposted). */
  renderRepost?: (comment: PostComment, authorName: string) => ReactNode;
}) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const emotes = useWithLibraryEmotes(placeEmotes);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  useAutoGrow(inputRef, text);
  // Just the target: its author's name is looked up live where it's shown, so a reply started
  // before their profile had loaded doesn't stay stuck showing a raw user ID.
  const [replyingTo, setReplyingTo] = useState<ReplyTarget>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const media = useStagedMedia(setError);
  const [visible, setVisible] = useState(PAGE_INITIAL_VISIBLE);
  const mention = useMentionAutocomplete({ text, setText, textareaRef: inputRef, people: mentionPeople });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const inline = inlineLimit !== undefined && !!onViewAll;
  const shown = comments.slice(-(inline ? inlineLimit : visible));
  const hiddenLoaded = comments.length - shown.length;

  const handleEarlier = async () => {
    setError(undefined);
    try {
      if (hiddenLoaded === 0) await onLoadOlder?.();
      setVisible((v) => v + REVEAL_STEP);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load earlier comments');
    }
  };

  const startReply = (target: ReplyTarget) => {
    setReplyingTo(target);
    inputRef.current?.focus();
  };

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const body = text.trim();
    if ((!body && media.staged.length === 0) || isOverLimit(body) || sending || media.preparing) return;
    setSending(true);
    setError(undefined);
    try {
      const attachments = await media.upload(!isPublic);
      const { formattedBody, mentionedUserIds } = buildMessageFormatting(body, emotes, mention.candidates());
      await onAdd(buildPostContent(body, formattedBody, { attachments, mentions: mentionedUserIds }), replyingTo);
      setText('');
      mention.reset();
      setReplyingTo(undefined);
      media.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send that comment');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (commentId: string, mine: boolean) => {
    const ok = await confirm({
      title: 'Delete comment',
      message: mine
        ? 'Delete your comment? This can’t be undone.'
        : 'Delete this comment for everyone? This can’t be undone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setError(undefined);
    try {
      await onDelete(commentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete that comment');
    }
  };

  const earlierControl = inline ? (
    (hiddenLoaded > 0 || hasOlder) && (
      <button
        type="button"
        className="nu-post__action nu-comments__earlier"
        data-nu-role="post-comments-view-all"
        onClick={onViewAll}
      >
        View all {totalLabel ?? comments.length} comments
      </button>
    )
  ) : (
    (hiddenLoaded > 0 || hasOlder) && (
      <button
        type="button"
        className="nu-post__action nu-comments__earlier"
        data-nu-role="post-comments-earlier"
        disabled={loadingOlder}
        onClick={() => void handleEarlier()}
      >
        {loadingOlder ? 'Loading…' : hiddenLoaded > 0 ? `Show earlier comments (${hiddenLoaded})` : 'Load earlier comments'}
      </button>
    )
  );

  return (
    <section className="nu-comments" data-nu-role="post-comments">
      {confirmDialog}
      {earlierControl}
      {shown.length > 0 && (
        <ul className="nu-comments__list">
          {shown.map((comment) => (
            <CommentItem
              key={comment.eventId}
              comment={comment}
              myUserId={myUserId}
              canDelete={comment.sender === myUserId || canRemoveAny}
              canReply={canComment}
              emotes={emotes}
              members={members}
              onDelete={() => void handleDelete(comment.eventId, comment.sender === myUserId)}
              onOpenProfile={onOpenProfile}
              {...(onReport && comment.sender !== myUserId && { onReport: () => onReport(comment.eventId) })}
              onReply={startReply}
              stats={commentStats[comment.eventId]}
              {...(onLikeComment && { onLike: () => onLikeComment(comment.eventId) })}
              renderRepost={renderRepost}
            />
          ))}
        </ul>
      )}

      {canComment ? (
        <form className="nu-comments__form" onSubmit={handleSubmit} data-nu-role="post-comment-form">
          {replyingTo && (
            <div className="nu-comments__replying" data-nu-role="post-comment-replying">
              <ReplyingToLabel userId={replyingTo.sender} members={members} role="post-comment-replying-to" />
              <button
                type="button"
                className="nu-post__action"
                aria-label="Cancel reply"
                data-nu-role="post-comment-reply-cancel"
                onClick={() => setReplyingTo(undefined)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          )}
          {mention.dropdown}
          <div className="nu-comments__row">
            <textarea
              ref={inputRef}
              className="nu-comments__input"
              data-nu-role="post-comment-input"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                mention.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (mention.handleKeyDown(e)) return;
                // Enter sends, like the chat composer; Shift+Enter is a new line.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
                if (e.key === 'Escape' && replyingTo) setReplyingTo(undefined);
              }}
              onPaste={media.addPasted}
              placeholder={replyingTo ? 'Write a reply…' : 'Write a comment…'}
              rows={1}
            />
            <button
              type="button"
              className="nu-post-composer__attach"
              data-nu-role="post-comment-attach"
              title="Add images or video"
              aria-label="Add images or video"
              disabled={media.full || media.preparing}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="image" size={16} />
            </button>
            <input
              ref={fileInputRef}
              className="nu-post-composer__file"
              type="file"
              accept={ACCEPTED_MEDIA_TYPES}
              multiple
              onChange={media.addFiles}
            />
            {/* Only near the cap: a counter on every short reply would be noise. */}
            {postLength(text) > POST_MAX_LENGTH - 100 && <CharCounter text={text} />}
            <button
              type="submit"
              className="nu-button nu-button--primary nu-comments__send"
              data-nu-role="post-comment-send"
              disabled={sending || media.preparing || isOverLimit(text) || (!text.trim() && media.staged.length === 0)}
            >
              {sending ? 'Sending…' : media.preparing ? 'Preparing…' : replyingTo ? 'Reply' : 'Comment'}
            </button>
          </div>
          <StagedMediaPreviews
            staged={media.staged}
            onRemove={media.remove}
            role="post-comment-previews"
            people={mentionPeople}
            onSetTags={media.setTags}
          />
        </form>
      ) : (
        cannotCommentReason && <p className="nu-comments__note" data-nu-role="post-comment-unavailable">{cannotCommentReason}</p>
      )}

      {error && (
        <p className="nu-field__error" data-nu-role="post-comment-error">
          {error}
        </p>
      )}
    </section>
  );
}
