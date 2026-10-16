import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { composerFocusAtom, sharedPostFilesAtom, sharedPostTextAtom } from '../../app/state/feed';
import { Icon } from '../../components/Icon';
import { useAutoGrow } from '../../components/useAutoGrow';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import type { Emote } from '../../matrix/emotes';
import { buildPostContent, savePrivatePost } from '../../matrix/feed';
import type { FeedSource } from '../../matrix/globalFeed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { nameOrFallback } from '../../matrix/displayName';
import { ACCEPTED_MEDIA_TYPES, formatBytes } from '../../matrix/postMedia';
import { publishToTarget, type PostTarget } from '../../matrix/postPublishing';
import { useWithLibraryEmotes } from '../../matrix/hooks/useEmoteLibrary';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { useComposerEmbeds } from '../../matrix/hooks/useComposerEmbeds';
import { ComposerEmbeds } from '../messaging/ComposerEmbeds';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { membersAsPeople, useMentionAutocomplete } from '../messaging/useMentionAutocomplete';
import { CharCounter, isOverLimit } from './CharCounter';
import { StagedMediaPreviews, useStagedMedia } from './useStagedMedia';
import './PostComposer.css';

export type ComposerTarget = { id: string; label: string; isPublic: boolean; target: PostTarget };

/** The last N-shortcut request a composer acted on (see the focus effect below). */
let handledFocusRequest = 0;

/** Who will be able to read a post sent to this target — shown under the box, always. */
function audienceHint(target: ComposerTarget | undefined, privately: boolean): string {
  if (privately) return 'Saved to your account, never sent to a room. Publish it later from Yours.';
  if (!target) return '';
  if (target.target.kind === 'global') return 'Anyone on the web can see this, even without signing in. It shows on your profile and the global feed.';
  return target.isPublic
    ? `Anyone in ${target.label} can read this, and it appears on the global feed.`
    : `Only members of ${target.label} can read this.`;
}

/**
 * Writing a post: text, up to four images/videos (JPG/PNG shrunk to WebP on the way, see
 * postMedia.ts), and where it goes. `targets` with more than one entry shows a destination
 * picker — the global feed offers Global plus each of your Spaces; a Space's own Posts page has
 * just that Space.
 */
export function PostComposer({
  targets,
  emotes: placeEmotes = [],
  placeholder,
  allowPrivate,
  ready = true,
  onPublished,
  onPrivateSaved,
}: {
  targets: ComposerTarget[];
  /** False until it's known which Spaces are public. Posting into a Space waits for it, because
   *  that decides who can read the post and whether its media is encrypted. Global never waits. */
  ready?: boolean;
  emotes?: Emote[];
  placeholder: string;
  /** Offers "Only me" — Space feeds only, since a private post is filed under a Space. */
  allowPrivate?: boolean;
  onPublished?: (source: FeedSource) => void;
  onPrivateSaved?: () => void;
}) {
  const mx = useMatrixClient();
  const { displayName } = useOwnProfile();
  const emotes = useWithLibraryEmotes(placeEmotes);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [privately, setPrivately] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  // A content warning: open once "CW" is pressed, and sent only if it has text.
  const [warningOpen, setWarningOpen] = useState(false);
  const [warning, setWarning] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const media = useStagedMedia(setError);
  const { staged, preparing } = media;
  // The focus effect below runs once per request, so it reaches the latest staging function by ref.
  const addSharedFiles = useRef(media.addPicked);
  addSharedFiles.current = media.addPicked;

  const target = targets.find((t) => t.id === targetId) ?? targets[0];

  // @mentions. In a Space post: its members, who are in the author's feed room (SpaceAutoJoiner
  // joins them), so the mention reaches them. In a Global post: anyone this client knows of; they
  // aren't in your profile room, so publishing invites them to it (matrix/mentionInvites.ts).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(textareaRef, text);
  const isGlobal = target?.target.kind === 'global';
  const spaceMembers = useRoomMembers(target?.target.kind === 'space' ? target.target.space.roomId : null);
  const people = useMemo(() => {
    const everyone = isGlobal
      ? mx.getUsers().map((user) => ({ userId: user.userId, name: nameOrFallback(user.displayName, user.userId), avatarUrl: user.avatarUrl }))
      : membersAsPeople(spaceMembers);
    return everyone.filter((person) => person.userId !== mx.getUserId());
  }, [isGlobal, spaceMembers, mx]);
  const mention = useMentionAutocomplete({ text, setText, textareaRef, people });
  const canPrivate = allowPrivate && target?.target.kind === 'space';
  const waitingOnPublicness = !ready && target?.target.kind === 'space';

  useEffect(() => {
    if (!targets.some((t) => t.id === targetId) && targets[0]) setTargetId(targets[0].id);
  }, [targets, targetId]);

  // The N shortcut (useComposeShortcut): whichever composer is actually on screen takes focus. A
  // feed kept mounted under a post or profile is hidden, and its composer stays out of it. A
  // composer that only appears because of the request (the global feed opening, say) takes it as
  // it mounts; one that mounts later doesn't, since the request is marked handled.
  // Text shared from another app (useShareTarget) rides the same request and lands in whichever
  // composer takes it.
  const focusRequest = useAtomValue(composerFocusAtom);
  const store = useStore();
  useEffect(() => {
    const input = textareaRef.current;
    if (focusRequest <= handledFocusRequest || !input || input.offsetParent === null) return;
    handledFocusRequest = focusRequest;
    const sharedFiles = store.get(sharedPostFilesAtom);
    if (sharedFiles) {
      store.set(sharedPostFilesAtom, null);
      void addSharedFiles.current(sharedFiles);
    }
    const shared = store.get(sharedPostTextAtom);
    if (shared) {
      store.set(sharedPostTextAtom, null);
      setText((current) => (current ? `${current}
${shared}` : shared));
    }
    input.focus();
    input.scrollIntoView({ block: 'nearest' });
  }, [focusRequest, store]);

  const tooLong = isOverLimit(text);
  // Link embeds (docs/embeds.md). Feed rooms aren't encrypted rooms, so posts always get them; their
  // pictures are encrypted wherever the post isn't public, like its media.
  const postIsPublic = !(privately && canPrivate) && !!target && (target.target.kind === 'global' || target.isPublic);
  const embeds = useComposerEmbeds(text, !(privately && canPrivate), !postIsPublic);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const body = text.trim();
    if ((!body && staged.length === 0) || tooLong || posting || preparing || !target || waitingOnPublicness) return;
    setPosting(true);
    setError(undefined);
    try {
      const keepPrivate = privately && canPrivate;
      // Plain uploads only where the post itself is public; everything else is encrypted, so the
      // media is exactly as private as the post it's in (see postMedia.ts).
      const destinationIsPublic = !keepPrivate && (target.target.kind === 'global' || target.isPublic);
      const attachments = await media.upload(!destinationIsPublic);

      if (keepPrivate && target.target.kind === 'space') {
        await savePrivatePost(mx, target.target.space.roomId, body, attachments);
        onPrivateSaved?.();
      } else {
        const { formattedBody, mentionedUserIds } = buildMessageFormatting(body, emotes, mention.candidates());
        const linkEmbeds = await embeds.prepare(body);
        const { source } = await publishToTarget(
          mx,
          target.target,
          buildPostContent(body, formattedBody, {
            attachments,
            embeds: linkEmbeds,
            mentions: mentionedUserIds,
            ...(warningOpen && { warning }),
            sensitive,
          }),
          displayName || mx.getUserId() || '',
          target.isPublic
        );
        onPublished?.(source);
      }
      setText('');
      mention.reset();
      embeds.reset();
      media.clear();
      setWarning('');
      setWarningOpen(false);
      setSensitive(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t post that');
    } finally {
      setPosting(false);
    }
  };

  const { savedBytes } = media;

  return (
    <form className="nu-post-composer" onSubmit={handleSubmit} data-nu-role="feed-composer">
      {mention.dropdown}
      {warningOpen && (
        <input
          className="nu-post-composer__warning"
          data-nu-role="feed-composer-warning"
          value={warning}
          onChange={(e) => setWarning(e.target.value)}
          placeholder="Content warning — what the post is about (spoilers, food, …)"
          maxLength={200}
          autoFocus
        />
      )}
      <textarea
        ref={textareaRef}
        className="nu-post-composer__input"
        data-nu-role="feed-composer-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          mention.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (mention.handleKeyDown(e)) return;
          // Ctrl/Cmd+Enter posts; plain Enter stays a new line, since posts run to paragraphs.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        onPaste={media.addPasted}
        placeholder={placeholder}
        rows={3}
      />
      <ComposerEmbeds previews={embeds.previews} onRemove={embeds.remove} />
      <StagedMediaPreviews staged={staged} onRemove={media.remove} role="feed-composer-previews" people={people} onSetTags={media.setTags} />
      <div className="nu-post-composer__bar">
        <button
          type="button"
          className="nu-post-composer__attach"
          data-nu-role="feed-composer-attach"
          title="Add images or video"
          aria-label="Add images or video"
          disabled={media.full || preparing}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="image" size={18} />
        </button>
        <button
          type="button"
          className={warningOpen ? 'nu-post-composer__cw nu-post-composer__cw--on' : 'nu-post-composer__cw'}
          data-nu-role="feed-composer-cw"
          title={warningOpen ? 'Remove the content warning' : 'Add a content warning'}
          aria-pressed={warningOpen}
          onClick={() => {
            setWarningOpen((open) => !open);
            setWarning('');
          }}
        >
          CW
        </button>
        {staged.length > 0 && (
          <label className="nu-post-composer__private" data-nu-role="feed-composer-sensitive" title="Blur the media until someone chooses to see it">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
            Sensitive
          </label>
        )}
        <input
          ref={fileInputRef}
          className="nu-post-composer__file"
          type="file"
          accept={ACCEPTED_MEDIA_TYPES}
          multiple
          onChange={media.addFiles}
        />
        {targets.length > 1 && (
          <label className="nu-post-composer__target">
            <span className="nu-post-composer__target-label">Post to</span>
            <select
              className="nu-post-composer__select"
              data-nu-role="feed-composer-target"
              value={target?.id}
              onChange={(e) => {
                setTargetId(e.target.value);
                setPrivately(false);
              }}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.target.kind === 'space' && !t.isPublic ? ' (members only)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {canPrivate && (
          <label className="nu-post-composer__private" data-nu-role="feed-composer-privacy">
            <input type="checkbox" checked={privately} onChange={(e) => setPrivately(e.target.checked)} />
            Only me
          </label>
        )}
        <CharCounter text={text} />
        <button
          type="submit"
          className="nu-button nu-button--primary nu-post-composer__submit"
          data-nu-role="feed-composer-submit"
          disabled={posting || preparing || waitingOnPublicness || tooLong || (!text.trim() && staged.length === 0)}
        >
          {posting ? 'Posting…' : preparing ? 'Preparing…' : privately && canPrivate ? 'Save' : 'Post'}
        </button>
      </div>
      <p className="nu-post-composer__hint" data-nu-role="feed-composer-hint">
        {waitingOnPublicness ? 'Checking who can see posts in this space…' : audienceHint(target, privately && !!canPrivate)}
        {savedBytes > 0 && ` Images converted to WebP, saving ${formatBytes(savedBytes)}.`}
      </p>
      {error && (
        <p className="nu-field__error" data-nu-role="feed-error">
          {error}
        </p>
      )}
    </form>
  );
}
