import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Direction, M_POLL_START, type MatrixClient, type MatrixEvent, type Room, type RoomMember } from 'matrix-js-sdk';
import { useAtom, useSetAtom } from 'jotai';
import { useAutoGrow } from '../../components/useAutoGrow';
import { Avatar, nameHue } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { ReportDialog } from '../feed/ReportDialog';
import { Menu, MenuItem } from '../../components/Menu';
import { addReminder, reminderChoices } from '../../matrix/reminders';
import { isEncryptedRoom } from '../../matrix/encryption';
import { webhookProfile } from '../../matrix/webhooks';
import { readVoiceServerConfig } from '../../matrix/voice';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import { RoleBadge } from '../../components/RoleBadge';
import { pendingJumpTargetAtom } from '../../app/state/selection';
import { useIrcMode } from '../../app/density';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import type { Emote } from '../../matrix/emotes';
import { useHiddenLibraryImages } from '../../matrix/hooks/useEmoteLibrary';
import { usePinnedEventIds } from '../../matrix/hooks/usePinnedEventIds';
import { useReactions, type ReactionGroup } from '../../matrix/hooks/useReactions';
import { useReadReceipts } from '../../matrix/hooks/useReadReceipts';
import { useRoomEmotes } from '../../matrix/hooks/useRoomEmotes';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { useRoomTimeline } from '../../matrix/hooks/useRoomTimeline';
import { useSavedMessages } from '../../matrix/hooks/useSavedMessages';
import { useThreads, type ThreadSummary } from '../../matrix/hooks/useThreads';
import { editMessage } from '../../matrix/edits';
import { canRedactEvent, canSendStateEvent } from '../../matrix/permissions';
import { pinMessage, unpinMessage } from '../../matrix/pins';
import { parsePollStart } from '../../matrix/polls';
import { removeReaction, sendReaction } from '../../matrix/reactions';
import { redactMessage } from '../../matrix/redaction';
import { getReplyEventId, type ReplyTarget } from '../../matrix/replies';
import { roleFor, roleMentionGroups, type RoleLevel } from '../../matrix/roles';
import type { MentionGroup } from '../../matrix/messageFormatting';
import { useSpaceRoles } from '../../matrix/hooks/useSpaceRoles';
import { saveMessage, unsaveMessage } from '../../matrix/savedMessages';
import { UserProfileModal } from '../profile/UserProfileModal';
import { EditHistoryModal } from './EditHistoryModal';
import { FileMessage } from './FileMessage';
import { ForwardMessageModal } from './ForwardMessageModal';
import { ImageMessage } from './ImageMessage';
import { LinkPreviewCard } from './LinkPreviewCard';
import { EmbedList } from './EmbedCard';
import { embeddableLinks, embedsContent, hasEmbedsField, readEmbeds } from '../../matrix/embeds';
import { prepareEmbeds } from '../../matrix/embedResolve';
import { readChannelPermissions } from '../../matrix/channelPermissions';
import { useEmbedSettings } from '../../matrix/embedSettings';
import { PollCard } from './PollCard';
import { WatchPartyCard } from '../calendar/WatchPartyCard';
import { NOTICE_EVENT_KEY } from '../../matrix/watchParty';
import { ReactionBar } from './ReactionBar';
import { ReactionPicker } from './ReactionPicker';
import { CollapsibleText } from './CollapsibleText';
import { extractFirstUrl, renderMessageText } from './renderMessageText';
import { ThreadPanel } from './ThreadPanel';
import { VoiceMessage } from './VoiceMessage';
import { initialRenderWindow, sliceRenderWindow, windowReaching } from './timelineWindow';
import './MessageTimeline.css';
import { fallbackName } from '../../matrix/displayName';
import { nameColorStyle, useNameColor } from '../../matrix/nameColor';

const HISTORY_PAGE_SIZE = 30;
/** The most a history page grows to when pages keep coming back without messages (loadMore). */
const MAX_HISTORY_PAGE = 600;
const HISTORY_MESSAGE_TYPES = new Set(['m.room.message', 'm.room.encrypted', 'm.sticker', 'org.matrix.msc3381.poll.start', 'm.poll.start']);
const LOAD_MORE_THRESHOLD_PX = 150;
const PINNED_THRESHOLD_PX = 40;
/** Below this many visible messages on first view, proactively backfill rather than waiting
 *  for the user to discover there's more by scrolling up themselves. */
const THIN_TIMELINE_THRESHOLD = 15;
/** How long after opening/re-opening a room to unconditionally force the bottom, extended by
 *  this much on every further content-size change (see the "settling" effect below). */
const SETTLE_EXTENSION_MS = 500;
/** Hard cap on the above, in case something pathological keeps resizing indefinitely. */
const MAX_SETTLE_MS = 4000;
/** Consecutive same-sender messages within this long of each other collapse into one visual
 *  group (one avatar/name, tightly-spaced lines below it) — matching Discord's own message
 *  grouping, the single biggest reason its timeline reads more compact than one row per message
 *  regardless of font/spacing size. Discord's own threshold isn't publicly documented to the
 *  minute; 5 minutes is a close, reasonable approximation. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** Scrolled further than this from the bottom, the "Jump to latest" button appears. */
const JUMP_BUTTON_THRESHOLD_PX = 400;

/** Where a room's view was left, if the reader was scrolled up in it: the message at the top of
 *  the view and how much history was drawn. */
type RoomViewMemory = { renderWindow: number; anchor: { eventId: string; offset: number } };
/** For the session, by room. Going back to a room you were reading further up in puts you back on
 *  the same message, with the same history drawn, instead of at the bottom with a screenful drawn
 *  and everything above to scroll back through (and draw) again. A room left at the bottom opens
 *  at the bottom, as it always did. */
const roomViews = new Map<string, RoomViewMemory>();

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** "Today" / "Yesterday" / "Tuesday, September 23" (plus the year once it isn't this year). */
function dayLabel(ts: number): string {
  const now = Date.now();
  if (isSameDay(ts, now)) return 'Today';
  if (isSameDay(ts, now - 24 * 60 * 60 * 1000)) return 'Yesterday';
  return (new Date(ts).getFullYear() !== new Date(now).getFullYear() ? DAY_WITH_YEAR : DAY).format(ts);
}

// Made once and reused: `toLocaleTimeString` and friends build a new formatter on every call,
// which, once per message on every redraw, was the single biggest cost of scrolling on a phone.
const TIME = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const SHORT_DATE = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
const SHORT_DATE_WITH_YEAR = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', year: 'numeric' });
/** IRC mode's time column: 24-hour, the console way (the Ultimit mockup's 09:12). */
const IRC_TIME = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DATE_TIME = new Intl.DateTimeFormat([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const DAY = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' });
const DAY_WITH_YEAR = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

function formatTime(ts: number): string {
  return TIME.format(ts);
}

/** A message's time beside its name: the time alone today, then short forms (the mockup's "Yday",
 *  "Oct 07") rather than a full numeric date. The full date and time are in its tooltip. */
function messageTime(ts: number): string {
  const now = Date.now();
  if (isSameDay(ts, now)) return formatTime(ts);
  if (isSameDay(ts, now - 24 * 60 * 60 * 1000)) return `Yday ${formatTime(ts)}`;
  const date = (new Date(ts).getFullYear() !== new Date(now).getFullYear() ? SHORT_DATE_WITH_YEAR : SHORT_DATE).format(ts);
  return `${date} ${formatTime(ts)}`;
}

/** A labeled rule across the timeline — a new day, or where your unread messages begin. */
function TimelineDivider({ label, variant }: { label: string; variant: 'day' | 'new' }) {
  return (
    <div className={`nu-timeline__divider nu-timeline__divider--${variant}`} data-nu-role={`timeline-divider-${variant}`} role="separator">
      <span className="nu-timeline__divider-label">{label}</span>
    </div>
  );
}

/** What you see once you've scrolled all the way back: the start of the channel, told plainly,
 *  instead of the timeline just running out. */
function ChannelWelcome({ room }: { room: Room }) {
  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent<{ topic?: string }>().topic;
  return (
    <div className="nu-timeline__welcome" data-nu-role="timeline-welcome">
      <div className="nu-timeline__welcome-icon" aria-hidden="true">
        <Icon name="hash" size={32} />
      </div>
      <h2 className="nu-timeline__welcome-title">Welcome to #{room.name}</h2>
      <p className="nu-timeline__welcome-text">{topic || `This is the very beginning of #${room.name}.`}</p>
    </div>
  );
}

/** Who a message is from as a reader sees it: a webhook's name and id, or no webhook at all. */
function webhookSenderKey(event: MatrixEvent, botUserId: string | undefined): string {
  const profile = webhookProfile(event, botUserId);
  return profile ? JSON.stringify([profile.id, profile.name]) : '';
}

function previewTextFor(event: MatrixEvent): string {
  const content = event.getContent();
  if (M_POLL_START.matches(event.getType())) return `📊 ${parsePollStart(event)?.question ?? 'Poll'}`;
  if (event.getType() === 'm.sticker') return `🎨 ${String(content.body ?? 'Sticker')}`;
  if (content.msgtype === 'm.image') return '📷 Image';
  if (content.msgtype === 'm.video') return '📹 Video';
  if (content.msgtype === 'm.audio') return '🔊 Audio';
  if (content.msgtype === 'm.file') return `📄 ${String(content.body ?? 'File')}`;
  const body = String(content.body ?? '');
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

/** The quoted-preview strip a reply shows above its own body — looks up the original event in
 *  the room's already-loaded events (`room.findEventById`); if it hasn't been loaded (e.g. it's
 *  further back than this session has paginated), shows a plain placeholder instead. Either way
 *  it's a button that jumps to the original (pendingJumpTargetAtom), which scrolls back through
 *  history to find one that isn't loaded yet. */
function ReplyPreview({ room, replyEventId }: { room: Room; replyEventId: string }) {
  const setPendingJump = useSetAtom(pendingJumpTargetAtom);
  const original = room.findEventById(replyEventId);
  const senderName = original && (original.sender?.name ?? fallbackName(original.getSender() ?? '?'));
  return (
    <button
      type="button"
      className={original ? 'nu-timeline__reply-preview' : 'nu-timeline__reply-preview nu-timeline__reply-preview--missing'}
      data-nu-role="timeline-reply-preview"
      title="Jump to the message this replies to"
      onClick={() => setPendingJump({ roomId: room.roomId, eventId: replyEventId })}
    >
      {original ? (
        <>
          ↩ <strong>{senderName}</strong>: {previewTextFor(original)}
        </>
      ) : (
        '↩ Replying to a message'
      )}
    </button>
  );
}

/** How long a finger rests on a message before its actions open. */
const LONG_PRESS_MS = 450;

/**
 * On a touch screen there's no hover: a tap left a message's hover toolbar stuck open over the
 * messages around it. Its actions open on a long press instead (as in Discord's and Telegram's
 * apps), and close at the next touch anywhere else. Does nothing with a mouse.
 */
function useLongPressActions() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = () => clearTimeout(timer.current);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (evt: Event) => {
      if (!ref.current?.contains(evt.target as Node)) setOpen(false);
    };
    document.addEventListener('touchstart', closeOutside, { passive: true });
    return () => document.removeEventListener('touchstart', closeOutside);
  }, [open]);
  useEffect(() => cancel, []);

  return {
    ref,
    open,
    close: () => setOpen(false),
    handlers: {
      onTouchStart: (evt: React.TouchEvent) => {
        cancel();
        if (evt.touches.length !== 1) return;
        // Not over something that's already a control of its own.
        if ((evt.target as HTMLElement).closest('a, button, input, textarea, video, audio, iframe, [role="button"]')) return;
        timer.current = setTimeout(() => {
          setOpen(true);
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      },
      onTouchMove: cancel,
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    },
  };
}

const NO_READERS: never[] = [];
const NO_REACTIONS: never[] = [];

/**
 * What about an event can change without it becoming a new object: decrypting it, an edit, its
 * local echo being confirmed (a new ID), its sending failing, a redaction. MessageRow is memoized
 * (only redrawn when its props change, not on every timeline update), so this is passed to it.
 */
function eventRevision(event: MatrixEvent): string {
  return [event.getId(), event.getType(), event.status ?? '', event.replacingEventId() ?? '', event.isRedacted(), event.isDecryptionFailure()].join('|');
}

/** Memoized: on a phone, redrawing every row for every scroll or timeline update made the app crawl. */
const MessageRow = memo(function MessageRow({
  mx,
  room,
  event,
  isPinned,
  canPin,
  isHighlighted,
  isGrouped,
  readers,
  emotes,
  reactionGroups,
  saved,
  threadSummary,
  onOpenThread,
  onReply,
  members,
  webhookBotId,
  roles,
  mentionGroups,
}: {
  mx: MatrixClient;
  room: Room;
  event: MatrixEvent;
  isPinned: boolean;
  canPin: boolean;
  isHighlighted: boolean;
  /** Continuing a burst from the same sender (see GROUP_WINDOW_MS) — renders without its own
   *  avatar/name/time row, just a hover-reveal timestamp in the avatar's usual column, matching
   *  Discord's own message grouping. */
  isGrouped: boolean;
  readers: RoomMember[];
  emotes: Emote[];
  reactionGroups: ReactionGroup[];
  saved: boolean;
  threadSummary?: ThreadSummary;
  /** Opens this message's thread (called with its event ID). */
  onOpenThread: (eventId: string | null) => void;
  /** Changes whenever the event does in place (eventRevision): the row is memoized. */
  revision: string;
  onReply: (target: ReplyTarget) => void;
  members: RoomMember[];
  /** The Space's service bot, whose messages may carry a webhook's name (matrix/webhooks.ts). */
  webhookBotId: string | undefined;
  /** The Space's roles, its own included (roles.ts). */
  roles: RoleLevel[];
  /** The roles that can be @-mentioned here, with who holds each (roleMentionGroups). */
  mentionGroups: MentionGroup[];
}) {
  const sender = event.sender;
  const webhook = webhookProfile(event, webhookBotId);
  const senderName = webhook?.name ?? sender?.name ?? fallbackName(event.getSender() ?? '?');
  const role = roleFor(webhook ? 0 : (sender?.powerLevel ?? 0), roles);
  const senderRole = role.custom ? 'custom' : role.id;
  const nameColor = useNameColor(webhook ? undefined : (event.getSender() ?? undefined));
  // event.getContent() already returns the latest m.replace edit's content automatically —
  // matrix-js-sdk aggregates edits onto the original event the same way it aggregates
  // reactions/thread relations (see room.relations, useReactions.ts/useThreads.ts). We just
  // need to know an edit happened at all, for the "(edited)" tag.
  const content = event.getContent();
  const hiddenMxcUrls = useHiddenLibraryImages();
  const replyEventId = getReplyEventId(event);
  const editedEvent = event.replacingEvent();
  const eventId = event.getId();
  const myUserId = mx.getUserId();
  const isOwnMessage = event.getSender() === myUserId;
  const mentionsMe = !!myUserId && !!content['m.mentions']?.user_ids?.includes(myUserId);
  const isMediaMessage =
    content.msgtype === 'm.image' ||
    content.msgtype === 'm.video' ||
    content.msgtype === 'm.audio' ||
    content.msgtype === 'm.file' ||
    event.getType() === 'm.sticker';
  const isPollMessage = M_POLL_START.matches(event.getType());
  const isEditable = isOwnMessage && !isMediaMessage && !isPollMessage && !event.isDecryptionFailure();
  const canDelete = canRedactEvent(room, mx.getUserId() ?? '', event);
  // A local echo (still sending, or sent but not yet confirmed by /sync) has a temporary "~"-
  // prefixed event ID. matrix-js-sdk crashes (`getPendingEvents` requires `pendingEventOrdering:
  // 'detached'`, which this client doesn't use) if you try to target one with a relation event —
  // edit, reply, pin, react, or redact all do exactly that — so those actions stay disabled
  // until event.status clears (see useRoomTimeline.ts's LocalEchoUpdated listener for the
  // re-render that unlocks this the moment it's safe).
  const isPending = event.status !== null;
  // Only plain m.text/m.notice bodies get a preview card — m.emote's body is a third-person
  // action line, not really "a message with a link in it" in the same sense, and media/edit
  // states render their own content instead of this branch at all.
  // Not in an encrypted conversation: a preview is the homeserver fetching the link, which would
  // tell it what was said there (Element skips them in encrypted rooms too).
  // Stored link embeds (docs/embeds.md) when the message has the field; otherwise, as before
  // embeds, the homeserver's preview of its first link.
  const embedSettings = useEmbedSettings();
  const storedEmbeds = readEmbeds(content as Record<string, unknown>);
  const firstUrl =
    content.msgtype !== 'm.emote' && !isEncryptedRoom(room) && !hasEmbedsField(content as Record<string, unknown>) && embedSettings.show !== 'none'
      ? extractFirstUrl(String(content.body ?? ''))
      : undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(editInputRef, draft);

  const toggleReaction = (group: ReactionGroup) => {
    if (group.hasOwnReaction) {
      if (group.ownEventId) void removeReaction(mx, room.roomId, group.ownEventId);
    } else if (eventId) {
      void sendReaction(mx, room.roomId, eventId, group.key, group.shortcode);
    }
  };

  const startEditing = () => {
    setDraft(String(content.body ?? ''));
    setIsEditing(true);
  };

  const saveEdit = () => {
    const newBody = draft.trim();
    setIsEditing(false);
    if (!eventId || !newBody || newBody === String(content.body ?? '')) return;
    void editWithEmbeds(newBody);
  };

  // An edit restates its embeds: the ones whose links are still there stay as they were, a link
  // that was there before without one (removed, or nothing to show) stays without, and a new
  // link is looked up (only where embeds are allowed: docs/embeds.md, rule 3).
  const editWithEmbeds = async (newBody: string) => {
    if (!eventId) return;
    const links = embeddableLinks(newBody);
    const before = new Set(embeddableLinks(String(content.body ?? '')));
    const kept = storedEmbeds.filter((embed) => links.includes(embed.url));
    const encrypted = isEncryptedRoom(room);
    const fresh = links.filter((url) => !before.has(url));
    const added = fresh.length && (!encrypted || embedSettings.encrypted) ? await prepareEmbeds(mx, fresh, encrypted) : [];
    const embeds = links.flatMap((url) => [...kept, ...added].filter((embed) => embed.url === url));
    const keepField = links.length > 0 && (hasEmbedsField(content as Record<string, unknown>) || added.length > 0);
    await editMessage(mx, room.roomId, eventId, newBody, keepField ? embedsContent(embeds) : {});
  };

  // The × on one of your own message's embeds: the same text, without it.
  const removeEmbed = (url: string) => {
    if (!eventId) return;
    const body = String(content.body ?? '');
    void editMessage(mx, room.roomId, eventId, body, embedsContent(storedEmbeds.filter((embed) => embed.url !== url)));
  };

  const [showProfile, setShowProfile] = useState(false);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [showForward, setShowForward] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const senderId = event.getSender();
  const touchActions = useLongPressActions();
  const ircMode = useIrcMode();

  return (
    <div
      ref={touchActions.ref}
      className={[
        'nu-timeline__message',
        isGrouped && 'nu-timeline__message--grouped',
        mentionsMe && 'nu-timeline__message--mentions-me',
        isHighlighted && 'nu-timeline__message--highlighted',
        touchActions.open && 'nu-timeline__message--actions-open',
      ]
        .filter(Boolean)
        .join(' ')}
      data-nu-role="timeline-message"
      data-nu-event-id={eventId ?? undefined}
      {...touchActions.handlers}
    >
      {ircMode ? (
        // IRC mode: no picture, the time in a column down the left on every line, as in the
        // mockup's lists. The day is on the divider above, so the time of day is enough here.
        <div className="nu-timeline__message-gutter nu-timeline__message-gutter--irc" data-nu-role="timeline-message-gutter">
          <time className="nu-timeline__message-irc-time" dateTime={new Date(event.getTs()).toISOString()} title={DATE_TIME.format(event.getTs())}>
            {IRC_TIME.format(event.getTs())}
          </time>
        </div>
      ) : isGrouped ? (
        <div className="nu-timeline__message-gutter" data-nu-role="timeline-message-gutter">
          <span className="nu-timeline__message-hover-time">{formatTime(event.getTs())}</span>
        </div>
      ) : (
        <button
          type="button"
          className="nu-timeline__message-avatar"
          data-nu-role="timeline-message-avatar"
          onClick={() => setShowProfile(true)}
        >
          <Avatar name={senderName} mxcUrl={webhook ? webhook.avatarUrl ?? null : sender?.getMxcAvatarUrl()} size={40} />
        </button>
      )}
      <div className="nu-timeline__message-body">
        {replyEventId && <ReplyPreview room={room} replyEventId={replyEventId} />}
        {(!isGrouped || editedEvent || isPinned) && (
          <div className="nu-timeline__message-meta">
            {!isGrouped && (
              <>
                <button
                  type="button"
                  className={`nu-timeline__message-sender nu-timeline__message-sender--${senderRole}`}
                  data-nu-role="timeline-message-sender"
                  // Staff take their role's color (CSS); everyone else the color they chose
                  // (nameColor.ts), or a stable per-name hue matching their fallback avatar, so a
                  // busy channel is easy to scan.
                  style={
                    senderRole === 'member'
                      ? { color: nameColorStyle(nameColor ?? `hsl(${nameHue(senderName)}, 70%, 78%)`) }
                      : role.color
                        ? { color: nameColorStyle(role.color) }
                        : undefined
                  }
                  onClick={() => setShowProfile(true)}
                >
                  {senderName}
                </button>
                <RoleBadge role={role} />
                {webhook && (
                  <span className="nu-timeline__app-badge" data-nu-role="timeline-webhook-badge" title="Posted by a webhook">
                    APP
                  </span>
                )}
                {!ircMode && (
                  <time className="nu-timeline__message-time" dateTime={new Date(event.getTs()).toISOString()} title={DATE_TIME.format(event.getTs())}>
                    {messageTime(event.getTs())}
                  </time>
                )}
              </>
            )}
            {editedEvent && (
              <button
                type="button"
                className="nu-timeline__message-edited-tag"
                data-nu-role="timeline-edited-tag"
                title={`Edited ${DATE_TIME.format(editedEvent.getTs())} — click to see edit history`}
                onClick={() => setShowEditHistory(true)}
              >
                (edited)
              </button>
            )}
            {isPinned && (
              <span className="nu-timeline__message-pinned-tag" data-nu-role="timeline-pinned-tag">
                <Icon name="pin" size={11} />
                Pinned
              </span>
            )}
          </div>
        )}
        {isEditing ? (
          <div className="nu-timeline__edit-form" data-nu-role="timeline-edit-form">
            <textarea
              ref={editInputRef}
              className="nu-timeline__edit-input"
              data-nu-role="timeline-edit-input"
              value={draft}
              autoFocus
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === 'Escape') {
                  setIsEditing(false);
                }
              }}
            />
            <div className="nu-timeline__edit-hint">Esc to cancel, Enter to save</div>
          </div>
        ) : event.isDecryptionFailure() ? (
          <div className="nu-timeline__message-text">[unable to decrypt]</div>
        ) : isPollMessage ? (
          <PollCard room={room} event={event} />
        ) : event.getType() === 'm.sticker' ? (
          <ImageMessage
            body={String(content.body ?? '')}
            url={content.url}
            file={content.file}
            mimetype={content.info?.mimetype}
            width={content.info?.w}
            height={content.info?.h}
          />
        ) : content.msgtype === 'm.image' ? (
          <ImageMessage
            body={String(content.body ?? '')}
            url={content.url}
            file={content.file}
            mimetype={content.info?.mimetype}
            width={content.info?.w}
            height={content.info?.h}
          />
        ) : content.msgtype === 'm.audio' && content['org.matrix.msc3245.voice'] ? (
          <VoiceMessage
            body={String(content.body ?? '')}
            url={content.url}
            file={content.file}
            mimetype={content.info?.mimetype}
            durationMs={content.info?.duration ?? content['org.matrix.msc1767.audio']?.duration}
            waveform={content['org.matrix.msc1767.audio']?.waveform}
          />
        ) : content.msgtype === 'm.video' || content.msgtype === 'm.audio' || content.msgtype === 'm.file' ? (
          <FileMessage
            msgtype={content.msgtype}
            body={String(content.body ?? '')}
            url={content.url}
            file={content.file}
            mimetype={content.info?.mimetype}
            size={content.info?.size}
          />
        ) : content.msgtype === 'm.emote' ? (
          <div className="nu-timeline__message-text nu-timeline__message-text--emote">
            * {senderName}{' '}
            {renderMessageText(String(content.body ?? ''), emotes, members, myUserId ?? undefined, {
              formattedBody: typeof content.formatted_body === 'string' ? content.formatted_body : undefined,
              hiddenMxcUrls,
              mentionGroups,
            })}
          </div>
        ) : (
          <>
            <CollapsibleText className="nu-timeline__message-text" text={String(content.body ?? '')}>
              {renderMessageText(String(content.body ?? ''), emotes, members, myUserId ?? undefined, {
                formattedBody: typeof content.formatted_body === 'string' ? content.formatted_body : undefined,
                hiddenMxcUrls,
                mentionGroups,
              })}
            </CollapsibleText>
            {firstUrl && <LinkPreviewCard url={firstUrl} />}
            {embedSettings.show !== 'none' && (
              <EmbedList
                embeds={storedEmbeds}
                eventKey={eventId ?? event.getTxnId() ?? ''}
                onRemove={isEditable && !isPending ? removeEmbed : undefined}
                noPlayers={readChannelPermissions(room).noPlayers}
              />
            )}
            {content.msgtype === 'm.notice' && typeof content[NOTICE_EVENT_KEY] === 'string' && (
              <WatchPartyCard room={room} eventId={content[NOTICE_EVENT_KEY]} />
            )}
          </>
        )}
        <ReactionBar
          groups={reactionGroups}
          onToggle={toggleReaction}
          myUserId={myUserId}
          nameOf={(userId) => room.getMember(userId)?.name ?? fallbackName(userId)}
          avatarOf={(userId) => room.getMember(userId)?.getMxcAvatarUrl()}
        />
        {threadSummary && (
          <button
            type="button"
            className="nu-timeline__message-thread-summary"
            data-nu-role="timeline-thread-summary"
            onClick={() => onOpenThread(eventId ?? null)}
          >
            <Icon name="threads" size={14} />
            <strong>
              {threadSummary.replyCount} {threadSummary.replyCount === 1 ? 'reply' : 'replies'}
            </strong>
            {threadSummary.lastReplySenderName && (
              <span className="nu-timeline__message-thread-last">Last from {threadSummary.lastReplySenderName}</span>
            )}
          </button>
        )}
        {readers.length > 0 && (
          <div className="nu-timeline__message-readers" data-nu-role="timeline-readers" title={readers.map((r) => r.name).join(', ')}>
            {readers.slice(0, 5).map((reader) => (
              <Avatar key={reader.userId} name={reader.name} mxcUrl={reader.getMxcAvatarUrl()} size={14} />
            ))}
          </div>
        )}
      </div>
      {!event.isDecryptionFailure() && eventId && !isEditing && !isPending && (
        <div className="nu-timeline__message-actions" data-nu-role="timeline-message-actions">
          <ReactionPicker room={room} onPick={(key, shortcode) => void sendReaction(mx, room.roomId, eventId, key, shortcode)} />
          <button
            type="button"
            className="nu-timeline__message-pin-action"
            data-nu-role="timeline-reply-action"
            title="Reply"
            aria-label="Reply"
            onClick={() => onReply({ eventId, senderName, preview: previewTextFor(event) })}
          >
            <Icon name="reply" size={16} />
          </button>
          <button
            type="button"
            className="nu-timeline__message-pin-action"
            data-nu-role="timeline-thread-action"
            title="Reply in thread"
            aria-label="Reply in thread"
            onClick={() => onOpenThread(eventId ?? null)}
          >
            <Icon name="threads" size={16} />
          </button>
          {/* Touch screens only (MessageTimeline.css): a long press opens these actions instead
              of selecting text, so copying needs a button of its own. */}
          {typeof content.body === 'string' && content.body && (
            <button
              type="button"
              className="nu-timeline__message-pin-action nu-timeline__message-copy-action"
              data-nu-role="timeline-copy-action"
              title="Copy text"
              aria-label="Copy text"
              onClick={() => {
                void navigator.clipboard?.writeText(String(content.body)).catch(() => undefined);
                touchActions.close();
              }}
            >
              <Icon name="copy" size={16} />
            </button>
          )}
          {!isPollMessage && (
            <button
              type="button"
              className="nu-timeline__message-pin-action"
              data-nu-role="timeline-forward-action"
              title="Forward"
              aria-label="Forward"
              onClick={() => setShowForward(true)}
            >
              <Icon name="forward" size={16} />
            </button>
          )}
          <button
            type="button"
            className="nu-timeline__message-pin-action"
            data-nu-role="timeline-save-action"
            title={saved ? 'Remove from saved' : 'Save message'}
            aria-label={saved ? 'Remove from saved' : 'Save message'}
            aria-pressed={saved}
            onClick={() => void (saved ? unsaveMessage(mx, room.roomId, eventId) : saveMessage(mx, room.roomId, eventId))}
          >
            <Icon name="bookmark" size={16} filled={saved} />
          </button>
          <Menu
            label="Remind me"
            trigger={<Icon name="bell" size={16} />}
            triggerClassName="nu-timeline__message-pin-action"
            role="timeline-remind-action"
            align="end"
          >
            {reminderChoices(new Date()).map((choice) => (
              <MenuItem
                key={choice.label}
                role="timeline-remind-choice"
                onSelect={() =>
                  // Account data isn't encrypted: an encrypted room's words stay out of it.
                  void addReminder(mx, { roomId: room.roomId, eventId, remindAt: choice.at, preview: isEncryptedRoom(room) ? '' : previewTextFor(event).slice(0, 140) }).catch(
                    (err: unknown) => console.warn('Couldn’t set the reminder', err)
                  )
                }
              >
                {choice.label}
              </MenuItem>
            ))}
          </Menu>
          {isEditable && (
            <button
              type="button"
              className="nu-timeline__message-pin-action"
              data-nu-role="timeline-edit-action"
              title="Edit"
              aria-label="Edit"
              onClick={startEditing}
            >
              <Icon name="pencil" size={16} />
            </button>
          )}
          {canPin && (
            <button
              type="button"
              className="nu-timeline__message-pin-action"
              data-nu-role="timeline-pin-action"
              title={isPinned ? 'Unpin' : 'Pin'}
              aria-label={isPinned ? 'Unpin' : 'Pin'}
              aria-pressed={isPinned}
              onClick={() => void (isPinned ? unpinMessage(mx, room, eventId) : pinMessage(mx, room, eventId))}
            >
              <Icon name="pin" size={16} filled={isPinned} />
            </button>
          )}
          {senderId && senderId !== mx.getUserId() && (
            <button
              type="button"
              className="nu-timeline__message-pin-action"
              data-nu-role="timeline-report-action"
              title="Report"
              aria-label="Report"
              onClick={() => setShowReport(true)}
            >
              <Icon name="flag" size={16} />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="nu-timeline__message-pin-action nu-timeline__message-delete-action"
              data-nu-role="timeline-delete-action"
              title="Delete"
              aria-label="Delete"
              onClick={() => void redactMessage(mx, room.roomId, eventId)}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      )}
      {showReport && eventId && (
        <ReportDialog
          roomId={room.roomId}
          eventId={eventId}
          what="message"
          event={event}
          space={mx.getRoom(findParentSpaceId(mx, room.roomId) ?? '') ?? undefined}
          onClose={() => setShowReport(false)}
        />
      )}
      {showProfile && senderId && (
        <UserProfileModal
          userId={senderId}
          displayName={senderName}
          avatarMxcUrl={sender?.getMxcAvatarUrl()}
          onClose={() => setShowProfile(false)}
        />
      )}
      {showEditHistory && (
        <EditHistoryModal roomId={room.roomId} event={event} onClose={() => setShowEditHistory(false)} />
      )}
      {showForward && <ForwardMessageModal event={event} onClose={() => setShowForward(false)} />}
    </div>
  );
});

/**
 * Renders `m.room.message` events, with image messages inline, pin/unpin, read receipts,
 * reactions, threads, and in-place edits (`m.replace` — aggregated onto the original event by
 * matrix-js-sdk itself, see `event.replacingEvent()`/`getContent()` in MessageRow; own messages
 * get an inline "Edit" action, see `matrix/edits.ts`). Consecutive same-sender messages within
 * GROUP_WINDOW_MS collapse into one visual group (MessageRow's `isGrouped`), Discord-style.
 */
export function MessageTimeline({ roomId, onReply }: { roomId: string; onReply: (target: ReplyTarget) => void }) {
  const ircMode = useIrcMode();
  const mx = useMatrixClient();
  const events = useRoomTimeline(roomId);
  const pinnedIds = usePinnedEventIds(roomId);
  const readReceipts = useReadReceipts(roomId);
  const reactions = useReactions(roomId);
  const threads = useThreads(roomId);
  const members = useRoomMembers(roomId);
  const savedMessages = useSavedMessages();
  const parentSpace = mx.getRoom(findParentSpaceId(mx, roomId) ?? '');
  const webhookBotId = parentSpace ? readVoiceServerConfig(mx, parentSpace)?.botUserId : undefined;
  const roles = useSpaceRoles(parentSpace);
  const mentionGroups = useMemo(() => roleMentionGroups(members, roles), [members, roles]);
  const savedEventIds = new Set(savedMessages.filter((item) => item.roomId === roomId).map((item) => item.eventId));
  const [openThreadRootId, setOpenThreadRootId] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useAtom(pendingJumpTargetAtom);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [renderWindow, setRenderWindow] = useState(initialRenderWindow);
  const renderWindowRef = useRef(renderWindow);
  renderWindowRef.current = renderWindow;
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Where your read receipt sat when you opened the room — captured once per room visit, before
  // this view marks everything read, so the "New" divider stays put while you read past it
  // instead of vanishing the instant the room opens.
  const [readMarkerEventId, setReadMarkerEventId] = useState<string | null>(null);

  // "Is the user currently at the bottom" — used only to decide whether a *new* message should
  // pull the view down while a room is already open and settled. It is deliberately NOT trusted
  // to decide the position when a room is first opened/re-opened: swapping a room's entire
  // content can itself trigger the browser's own scroll-position clamping (the old scrollTop
  // may no longer be valid for the new content's height), which fires ordinary 'scroll' events
  // indistinguishable from a real user scroll — and that was corrupting this value before our
  // own snap-to-bottom logic ever got to run, which is why it kept landing in a consistent
  // wrong spot on every revisit rather than varying. Opening a room forces the bottom instead,
  // unless it was left scrolled up (roomViews): then it goes back to the remembered message, by
  // its anchor below, never by a scroll position.
  const pinnedToBottomRef = useRef(true);
  // The first message visible at the top of the viewport, and how far below the container's top
  // edge it sat — refreshed on every scroll. When not pinned to the bottom, any change in content
  // height (older messages prepended, an image above you finishing its fetch+decrypt) restores
  // that message to the same spot, so nothing you're looking at moves. This is our own stand-in
  // for the browser's scroll anchoring, which the CSS turns off (overflow-anchor: none) so it
  // can't fight the stay-at-the-bottom logic.
  const anchorRef = useRef<{ eventId: string; offset: number } | null>(null);
  const autoBackfillDoneRef = useRef(false);
  // Set while a room is being put back where it was left (roomViews) and its message isn't drawn
  // yet: the render before the room's events arrive still shows the previous room's, short, view,
  // which looks scrolled to the top and would fetch history nobody asked for.
  const restoringRef = useRef(false);
  const pageSizeRef = useRef(HISTORY_PAGE_SIZE);
  // Set when a scrollback fails, so the automatic fill below doesn't retry in a loop; scrolling
  // up still retries by hand.
  const autoFillFailedRef = useRef(false);
  const roomEnteredAtRef = useRef(0);
  const forceBottomUntilRef = useRef(0);

  const room = mx.getRoom(roomId);
  // Read from the live timeline on every render rather than kept as state: a limited sync replaces
  // the live timeline with a fresh one holding only the newest events (see useRoomTimeline), and a
  // flag remembered from the old one said "nothing older" about a timeline that's gone.
  const atStart = room ? room.getLiveTimeline().getPaginationToken(Direction.Backward) === null : false;
  const emotes = useRoomEmotes(room ?? undefined);
  const canPin = room ? canSendStateEvent(room, mx.getUserId() ?? '', 'm.room.pinned_events') : false;
  const pinnedIdSet = new Set(pinnedIds);

  const messages = events.filter((event) => {
    if (event.isRedacted()) return false;
    if (event.isDecryptionFailure()) return true;
    if (event.getType() === 'm.sticker') return true;
    // A poll's own m.poll.response/m.poll.end events are a different type each, so they fall
    // through to `return false` below without needing an explicit exclusion — only their
    // m.poll.start (rendered as PollCard) belongs in the timeline itself.
    if (M_POLL_START.matches(event.getType())) return true;
    if (event.getType() !== 'm.room.message') return false;
    const relType = event.getContent()['m.relates_to']?.rel_type;
    // Thread replies render inside their thread's panel only (ThreadPanel), not inline here too
    // — same convention Element uses. Their fallback m.in_reply_to is what non-thread-aware
    // clients render instead; we don't need it since we do support threads.
    return relType !== 'm.replace' && relType !== 'm.thread';
  });

  // Only the latest `renderWindow` messages are drawn; the rest stay loaded and are revealed by
  // scrolling up (loadMore above).
  const { shown: shownMessages, hiddenOlder: hiddenOlderCount } = sliceRenderWindow(messages, renderWindow);

  // A layout effect, so a room opened again is put back where it was left before it's painted.
  useLayoutEffect(() => {
    const now = Date.now();
    // A pending jump (from search) targets an exact message, not the bottom — don't fight it
    // with the usual "always open a room at the bottom" behavior.
    const jumpingHere = pendingJump?.roomId === roomId;
    // Left scrolled up, and that message is still loaded (a limited sync can have replaced the
    // timeline since): back to it (roomViews).
    const remembered = jumpingHere ? undefined : roomViews.get(roomId);
    const liveEvents = mx.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [];
    const anchorIndex = remembered ? liveEvents.findIndex((event) => event.getId() === remembered.anchor.eventId) : -1;
    const restore = anchorIndex >= 0 ? remembered : undefined;
    pinnedToBottomRef.current = !jumpingHere && !restore;
    anchorRef.current = restore ? { ...restore.anchor } : null;
    restoringRef.current = !!restore;
    autoBackfillDoneRef.current = !!restore;
    autoFillFailedRef.current = false;
    pageSizeRef.current = HISTORY_PAGE_SIZE;
    roomEnteredAtRef.current = now;
    forceBottomUntilRef.current = jumpingHere || restore ? 0 : now + SETTLE_EXTENSION_MS;
    // Drawn back to that message at least, counting what arrived since (an overestimate: events,
    // not just messages, follow it).
    setRenderWindow(
      restore ? Math.max(restore.renderWindow, windowReaching(liveEvents.length, anchorIndex, HISTORY_PAGE_SIZE)) : initialRenderWindow()
    );
    setShowJumpToLatest(!!restore);
    const myUserId = mx.getUserId();
    setReadMarkerEventId(myUserId ? mx.getRoom(roomId)?.getEventReadUpTo(myUserId) ?? null : null);
    keepScrollPosition();
    const anchor = anchorRef;
    const pinned = pinnedToBottomRef;
    const drawn = renderWindowRef;
    return () => {
      // Leaving the room (or the view): remember where, if it wasn't the bottom.
      if (!pinned.current && anchor.current) roomViews.set(roomId, { renderWindow: drawn.current, anchor: { ...anchor.current } });
      else roomViews.delete(roomId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Marks the room read by sending an `m.read` receipt for the newest message — this app
  // previously never sent one at all (only ever *displayed* other members' receipts, see
  // useReadReceipts.ts), which also meant unread/notification counts server-side never cleared.
  // Fires on opening a room (pinnedToBottomRef starts true on every room switch, see above) and
  // again whenever a new message arrives while still scrolled to the bottom — but not while
  // scrolled up reading history, matching Element's own behavior of not marking-read content
  // you haven't actually scrolled to.
  const lastMessageId = messages[messages.length - 1]?.getId();
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !pinnedToBottomRef.current) return;
    mx.sendReadReceipt(lastMessage).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, roomId, lastMessageId]);

  const loadMore = async () => {
    const currentRoom = mx.getRoom(roomId);
    const container = containerRef.current;
    if (!currentRoom || !container || loadingMore) return;
    // Older messages already loaded but not drawn come first: no request needed.
    if (hiddenOlderCount > 0) {
      setRenderWindow((size) => size + HISTORY_PAGE_SIZE);
      return;
    }
    if (atStart) return;
    setLoadingMore(true);
    try {
      // Not mx.scrollback: that treats any empty page as the start of the room, and a server
      // still backfilling a room from other servers can answer with an empty page that has more
      // behind it. This stops only when the server says there's nothing older (no `end` token).
      const timeline = currentRoom.getLiveTimeline();
      const before = timeline.getEvents().length;
      await mx.paginateEventTimeline(timeline, { backwards: true, limit: pageSizeRef.current });
      // Older events are added at the front. A page with no messages in it (state changes,
      // reactions, edits) asks for three times as many next time, up to MAX_HISTORY_PAGE: a
      // channel buried under thousands of permission changes took dozens of round trips to show
      // anything. A page with messages goes back to the usual size.
      const added = timeline.getEvents().slice(0, Math.max(0, timeline.getEvents().length - before));
      const anyMessage = added.some((event) => HISTORY_MESSAGE_TYPES.has(event.getType()));
      pageSizeRef.current = anyMessage ? HISTORY_PAGE_SIZE : Math.min(MAX_HISTORY_PAGE, pageSizeRef.current * 3);
    } catch (err) {
      autoFillFailedRef.current = true;
      console.warn('MessageTimeline: loading older messages failed', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const captureAnchor = () => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const top = container.getBoundingClientRect().top;
    // The first row reaching below the top edge, by binary search: rows are in order down the
    // page, so a handful of measurements instead of one per row. This runs on every scroll event,
    // and measuring every row each time made scrolling stutter on phones.
    const rows = content.querySelectorAll<HTMLElement>('[data-nu-event-id]');
    let low = 0;
    let high = rows.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (rows[mid].getBoundingClientRect().bottom > top) {
        found = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    if (found < 0) {
      anchorRef.current = null;
      return;
    }
    const el = rows[found];
    anchorRef.current = { eventId: el.dataset.nuEventId ?? '', offset: el.getBoundingClientRect().top - top };
  };

  // Called after anything that may have changed the content's height: while the room is still
  // settling in, or the user is pinned to the bottom, follow the bottom; otherwise put the
  // anchored message back where it was.
  const keepScrollPosition = () => {
    const container = containerRef.current;
    if (!container) return;

    const now = Date.now();
    const stillSettling = now < forceBottomUntilRef.current && now - roomEnteredAtRef.current < MAX_SETTLE_MS;
    if (stillSettling) {
      forceBottomUntilRef.current = Math.min(now + SETTLE_EXTENSION_MS, roomEnteredAtRef.current + MAX_SETTLE_MS);
    }

    if (stillSettling || pinnedToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    } else if (anchorRef.current) {
      const el = container.querySelector<HTMLElement>(`[data-nu-event-id="${CSS.escape(anchorRef.current.eventId)}"]`);
      // Not drawn (yet): a room being put back where it was left draws back to it on its next
      // render. Measuring now would replace the anchor with whatever's on screen meanwhile.
      if (!el) return;
      const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += offset - anchorRef.current.offset;
      restoringRef.current = false;
    }
    captureAnchor();
  };

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    captureAnchor();

    // Scrolls our own settling and anchoring cause aren't a reason to fetch history: only the
    // reader getting near the top is.
    if (container.scrollTop < LOAD_MORE_THRESHOLD_PX && Date.now() >= forceBottomUntilRef.current && !restoringRef.current) {
      void loadMore();
    }

    // Ignore scroll noise while a room is still settling in — see the big comment above.
    if (Date.now() < forceBottomUntilRef.current) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom < PINNED_THRESHOLD_PX;
    setShowJumpToLatest(distanceFromBottom > JUMP_BUTTON_THRESHOLD_PX);
  };

  // The reader taking hold of the scroll (wheel, touch, a key, dragging the scrollbar) ends the
  // settle window at once. It used to run its course regardless, and a room whose images were
  // slow to arrive (other servers' media) kept pulling you back to the bottom for up to
  // MAX_SETTLE_MS while you were trying to scroll up.
  const endSettling = () => {
    restoringRef.current = false;
    forceBottomUntilRef.current = 0;
  };

  const jumpToLatest = () => {
    pinnedToBottomRef.current = true;
    setShowJumpToLatest(false);
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  // Resolves a pending jump target (from search — see pendingJumpTargetAtom): scroll to and
  // highlight the message once it's actually rendered, backfilling further back if it's older
  // than what this room view has loaded so far, and giving up once scrollback hits the start of
  // the room. A thread reply can never render in this main list (see the `messages` filter
  // above), so those open the reply's thread panel instead of trying to scroll to it here.
  useEffect(() => {
    if (!pendingJump || pendingJump.roomId !== roomId) return;
    const target = room?.findEventById(pendingJump.eventId);
    if (!target) {
      if (!atStart && !loadingMore) void loadMore();
      return;
    }
    if (target.getContent()['m.relates_to']?.rel_type === 'm.thread') {
      const rootId = target.threadRootId ?? target.getContent()['m.relates_to']?.event_id;
      if (rootId) setOpenThreadRootId(rootId);
      setPendingJump(null);
      return;
    }
    // In the room but not yet in this view's list (the view's first render, before its events
    // arrive from useRoomTimeline): the next render has it. Giving up here dropped jumps into a
    // small room, which is at its start at once and so had nothing older to load meanwhile.
    if (room?.getLiveTimeline().getEvents().includes(target) && !events.includes(target)) return;
    const el = containerRef.current?.querySelector(`[data-nu-event-id="${CSS.escape(pendingJump.eventId)}"]`);
    const targetIndex = messages.findIndex((message) => message.getId() === pendingJump.eventId);
    if (!el && targetIndex >= 0 && targetIndex < hiddenOlderCount) {
      // Loaded, but older than the drawn window: draw back to it (and a little past) in one step.
      setRenderWindow(windowReaching(messages.length, targetIndex, HISTORY_PAGE_SIZE));
    } else if (el) {
      // Jumping within an already-open room never goes through the room-switch reset effect
      // above (roomId hasn't changed), so pinnedToBottomRef is still whatever it was before —
      // left true, the very next resize-driven re-render (an avatar/image finishing its
      // fetch, say) would snap the view straight back to the bottom, undoing the jump.
      pinnedToBottomRef.current = false;
      el.scrollIntoView({ block: 'center' });
      // Re-anchor now rather than waiting on the scroll event: a resize landing first would
      // otherwise restore the pre-jump anchor and undo the jump.
      captureAnchor();
      setHighlightedEventId(pendingJump.eventId);
      setPendingJump(null);
    } else if (!atStart && !loadingMore) {
      void loadMore();
    } else {
      setPendingJump(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, roomId, room, events, messages.length, renderWindow, atStart, loadingMore]);

  useEffect(() => {
    if (!highlightedEventId) return undefined;
    const timer = setTimeout(() => setHighlightedEventId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedEventId]);

  // A freshly-synced room can start with a thin initial timeline — the homeserver's sync only
  // sends a limited backlog per room, and a limited sync later on (a sleeping laptop, a tab left
  // in the background) cuts an open room back to just that. Back-fill proactively once when a
  // room's view is thin, and then for as long as the top of the view is still near the top of
  // what's loaded. Older pages otherwise load only from a scroll event near the top, and none
  // comes when a page lands and you're still up there (a page can be mostly reactions, edits and
  // member events) or when the view is too short to scroll at all: you had to scroll away and
  // back, sometimes several times, or were stuck with a handful of messages.
  useEffect(() => {
    if (atStart || loadingMore || autoFillFailedRef.current || restoringRef.current) return;
    const container = containerRef.current;
    const thin = !autoBackfillDoneRef.current && messages.length < THIN_TIMELINE_THRESHOLD;
    const nearTop = !!container && container.scrollTop < LOAD_MORE_THRESHOLD_PX;
    if (!thin && !nearTop) return;
    autoBackfillDoneRef.current = true;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, events, renderWindow, atStart, loadingMore]);

  // A new or prepended page of messages: runs before paint, so an older page landing above you
  // (or a new message below while pinned) never shows a frame in the wrong spot.
  // Sending a message (its local echo landing at the end) takes you to the bottom to see it, even
  // from further up, as in Discord and Element.
  const lastSeenIdRef = useRef<string | undefined>();
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.getId() !== lastSeenIdRef.current && last.status !== null && last.getSender() === mx.getUserId()) {
      pinnedToBottomRef.current = true;
      restoringRef.current = false;
      setShowJumpToLatest(false);
    }
    lastSeenIdRef.current = last?.getId();
    keepScrollPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, renderWindow]);

  // Everything else that changes the timeline's rendered height after the fact — an avatar
  // finishing its fetch, an image or video finishing its fetch+decrypt, a link preview arriving.
  // While still within this room-view's settle window (forceBottomUntilRef) it snaps to the
  // bottom unconditionally and keeps extending that window for as long as content keeps
  // changing size; after that it follows the bottom only if the user is pinned there, and
  // otherwise holds the anchored message in place. It used to skip every resize while a
  // scrollback was in flight — and opening an image-heavy room almost always starts one (few
  // messages → thin-timeline backfill) — so the images loading meanwhile pushed the view up.
  // The timeline's own box too: on a phone the keyboard coming up (useVisualViewport.ts) or the
  // composer growing a line shrinks it without any scroll event, which left the newest messages,
  // your own just sent among them, hidden below the bottom edge.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return undefined;

    // keepScrollPosition only reads refs, so this first render's copy stays correct.
    const observer = new ResizeObserver(() => keepScrollPosition());

    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (!room) return null;

  // The "New" divider goes above the first message after your old read marker — unless
  // everything after it is your own (you replied, so you've obviously seen what came before).
  const myUserId = mx.getUserId();
  const markerIndex = readMarkerEventId ? shownMessages.findIndex((event) => event.getId() === readMarkerEventId) : -1;
  const firstUnreadIndex =
    markerIndex >= 0 && shownMessages.slice(markerIndex + 1).some((event) => event.getSender() !== myUserId) ? markerIndex + 1 : -1;

  return (
    <div
      className="nu-timeline"
      data-nu-role="timeline"
      ref={containerRef}
      onScroll={handleScroll}
      onWheel={endSettling}
      onTouchStart={endSettling}
      onKeyDown={endSettling}
      onPointerDown={endSettling}
    >
      {loadingMore && (
        <div className="nu-timeline__loading" data-nu-role="timeline-loading">
          <span>Loading more…</span>
        </div>
      )}
      <div className="nu-timeline__content" ref={contentRef}>
        {atStart && hiddenOlderCount === 0 && <ChannelWelcome room={room} />}
        {shownMessages.map((event, index) => {
          const prevEvent = shownMessages[index - 1];
          const newDay = !prevEvent || !isSameDay(prevEvent.getTs(), event.getTs());
          const isFirstUnread = index === firstUnreadIndex;
          const isGrouped =
            !!prevEvent &&
            !newDay &&
            !isFirstUnread &&
            prevEvent.getSender() === event.getSender() &&
            // Two webhooks posting through the same bot are two senders as far as anyone reading can
            // tell, and so is one webhook posting under two names (a request's `username`).
            webhookSenderKey(prevEvent, webhookBotId) === webhookSenderKey(event, webhookBotId) &&
            !getReplyEventId(event) &&
            // IRC mode keeps one person's run of messages together however long it goes.
            (ircMode || event.getTs() - prevEvent.getTs() < GROUP_WINDOW_MS);
          return (
            // A message you send starts as a local echo with a temporary ID, which changes when
            // the server confirms it; keyed on that ID, the row remounted then and flickered. The
            // transaction ID stays put on the same event object across the switch.
            <Fragment key={event.getTxnId() ?? event.getId()}>
            {newDay && <TimelineDivider variant="day" label={dayLabel(event.getTs())} />}
            {isFirstUnread && <TimelineDivider variant="new" label="New" />}
            <MessageRow
              mx={mx}
              room={room}
              event={event}
              isPinned={pinnedIdSet.has(event.getId() ?? '')}
              canPin={canPin}
              isHighlighted={!!event.getId() && event.getId() === highlightedEventId}
              isGrouped={isGrouped}
              readers={readReceipts.get(event.getId() ?? '') ?? NO_READERS}
              emotes={emotes}
              reactionGroups={reactions.get(event.getId() ?? '') ?? NO_REACTIONS}
              saved={savedEventIds.has(event.getId() ?? '')}
              threadSummary={threads.get(event.getId() ?? '')}
              onOpenThread={setOpenThreadRootId}
              revision={eventRevision(event)}
              onReply={onReply}
              members={members}
              webhookBotId={webhookBotId}
              roles={roles}
              mentionGroups={mentionGroups}
            />
            </Fragment>
          );
        })}
      </div>
      <div ref={bottomRef} />
      {showJumpToLatest && (
        <div className="nu-timeline__jump-anchor">
          <button
            type="button"
            className="nu-timeline__jump"
            data-nu-role="timeline-jump-to-latest"
            onClick={jumpToLatest}
          >
            <Icon name="arrowDown" size={16} />
            Jump to latest
          </button>
        </div>
      )}
      {openThreadRootId &&
        (() => {
          const rootEvent = room.findEventById(openThreadRootId);
          return rootEvent ? (
            <ThreadPanel
              room={room}
              rootEvent={rootEvent}
              emotes={emotes}
              onClose={() => setOpenThreadRootId(null)}
            />
          ) : null;
        })()}
    </div>
  );
}
