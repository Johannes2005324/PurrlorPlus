import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { buildPostContent } from '../../matrix/feed';
import { ACCEPTED_MEDIA_TYPES, formatBytes, getUploadLimit, prepareMedia, uploadPostMedia, type PreparedMedia } from '../../matrix/postMedia';
import { publishStory } from '../../matrix/stories';

/** A story's caption is a line or two over a picture, not a post. */
export const STORY_CAPTION_MAX = 200;

/**
 * Making a story: one picture or video, a caption, or both. It goes to your profile room, so it's
 * public like a Global post, and gone after a day (matrix/stories.ts).
 */
export function StoryComposer({ displayName, onClose, onPosted }: { displayName: string; onClose: () => void; onPosted: () => void }) {
  const mx = useMatrixClient();
  const [media, setMedia] = useState<PreparedMedia>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!media) return;
    const url = URL.createObjectURL(media.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    try {
      setMedia(await prepareMedia(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const text = caption.trim();
  const canPost = !busy && (!!media || !!text) && [...caption].length <= STORY_CAPTION_MAX;

  const post = async () => {
    if (!canPost) return;
    setBusy(true);
    setError(undefined);
    try {
      let attachments;
      if (media) {
        const limit = await getUploadLimit(mx);
        if (limit && media.file.size > limit) throw new Error(`That file is ${formatBytes(media.file.size)}; this server takes up to ${formatBytes(limit)}.`);
        attachments = [await uploadPostMedia(mx, media, { encrypt: false })];
      }
      await publishStory(mx, displayName, buildPostContent(text, undefined, { attachments }));
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The story couldn’t be posted.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New story" onClose={onClose}>
      <div className="nu-story-composer" data-nu-role="story-composer">
        {media && previewUrl ? (
          <div className="nu-story-composer__preview">
            {media.kind === 'video' ? (
              <video src={previewUrl} className="nu-story-composer__media" muted autoPlay loop playsInline />
            ) : (
              <img src={previewUrl} alt="" className="nu-story-composer__media" />
            )}
            <button type="button" className="nu-story-composer__remove" aria-label="Remove" onClick={() => setMedia(undefined)} disabled={busy}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ) : (
          <button type="button" className="nu-story-composer__pick" data-nu-role="story-pick" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Icon name="image" size={28} />
            <span>Add a picture or video</span>
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_MEDIA_TYPES}
          hidden
          onChange={(evt) => {
            void pick(evt.target.files?.[0]);
            evt.target.value = '';
          }}
        />
        <textarea
          className="nu-story-composer__caption"
          data-nu-role="story-caption"
          placeholder={media ? 'Add a caption' : 'Say something'}
          value={caption}
          rows={3}
          maxLength={STORY_CAPTION_MAX * 2}
          onChange={(evt) => setCaption(evt.target.value)}
          disabled={busy}
        />
        <p className="nu-story-composer__note">
          Anyone can see your story for 24 hours, then it's deleted. {[...caption].length}/{STORY_CAPTION_MAX}
        </p>
        {error && (
          <p className="nu-story-composer__error" role="alert">
            {error}
          </p>
        )}
        <div className="nu-story-composer__actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="nu-button nu-button--primary" data-nu-role="story-post" onClick={() => void post()} disabled={!canPost}>
            {busy ? 'Posting…' : 'Share story'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
