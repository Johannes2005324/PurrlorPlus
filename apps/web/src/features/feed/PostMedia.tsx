import { useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { usePauseWhenOffscreen } from '../../components/usePauseWhenOffscreen';
import { inlineThumbnailSize, useAttachmentUrl } from '../../matrix/hooks/useAttachmentUrl';
import { AttachmentDownloadButton } from '../messaging/AttachmentDownloadButton';
import { AttachmentLightbox } from '../messaging/AttachmentLightbox';
import { attachmentMxc, POST_MEDIA_PX, type PostAttachment } from '../../matrix/postMedia';
import { TaggedImageOverlay } from './ImageTags';
import './PostMedia.css';

function ratioStyle(attachment: PostAttachment): CSSProperties | undefined {
  const { w, h } = attachment.info;
  return w && h ? { aspectRatio: `${w} / ${h}` } : undefined;
}

function MediaItem({ attachment, single }: { attachment: PostAttachment; single: boolean }) {
  // An encrypted attachment is fetched and decrypted here with the key from the post itself.
  const { mimetype, w, h } = attachment.info;
  const source = { url: attachment.url, file: attachment.file, mimetype };
  // Images inline as a thumbnail about the feed's width (the whole file opens in the lightbox);
  // video streams from the media URL.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnail =
    attachment.kind === 'video' || thumbnailFailed ? undefined : inlineThumbnailSize(mimetype, w, h, POST_MEDIA_PX, POST_MEDIA_PX);
  const src = useAttachmentUrl(source, { direct: true, thumbnail });
  const [open, setOpen] = useState(false);
  const videoRef = usePauseWhenOffscreen();
  const imgRef = useRef<HTMLImageElement>(null);
  // One item keeps its own shape (reserved up front from w/h, so nothing jumps when it loads);
  // in a grid every cell is square and the media is cropped to fill it.
  const style = single ? ratioStyle(attachment) : undefined;

  if (!src) {
    return <div className="nu-post-media__item nu-post-media__item--loading" data-nu-role="post-media-loading" style={style} />;
  }

  if (attachment.kind === 'video') {
    return (
      <div className="nu-post-media__item nu-post-media__item--video" style={style}>
        {/* Nothing autoplays: it plays, with its sound, when the reader presses play, and stops
            when it's off screen (including when the whole feed is hidden under a chat). Loops, since
            many are GIF replacements. The player's own download is hidden: it can't send the
            token, and saved the server's error as a .json file. */}
        <video
          ref={videoRef}
          className="nu-post-media__video"
          data-nu-role="post-media-video"
          src={src}
          controls
          controlsList="nodownload"
          loop
          playsInline
          preload="metadata"
        />
        <AttachmentDownloadButton className="nu-post-media__download" source={source} name={attachment.name} />
      </div>
    );
  }

  const image = (
    <button
      type="button"
      className={attachment.tags?.length ? 'nu-post-media__open' : 'nu-post-media__item nu-post-media__item--image'}
      data-nu-role="post-media-image"
      style={attachment.tags?.length ? undefined : style}
      onClick={() => setOpen(true)}
    >
      <img
        ref={imgRef}
        className="nu-post-media__img"
        src={src}
        alt={attachment.name}
        loading="lazy"
        onError={thumbnail ? () => setThumbnailFailed(true) : undefined}
      />
    </button>
  );

  return (
    <>
      {attachment.tags?.length ? (
        // People tagged in it (matrix/imageTags.ts): the picture, and their names over it on request.
        <div className="nu-post-media__item nu-post-media__item--image nu-post-media__item--tagged" style={style}>
          {image}
          <TaggedImageOverlay tags={attachment.tags} imgRef={imgRef} fit={single ? 'contain' : 'cover'} />
        </div>
      ) : (
        image
      )}
      {open && <AttachmentLightbox source={source} preview={src} alt={attachment.name} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * A post's images and videos: one shown at its own shape, two to four as a grid. Media its author
 * marked sensitive is blurred, with nothing playable or openable, until the reader asks to see it.
 */
export function PostMedia({ attachments, sensitive = false }: { attachments: PostAttachment[]; sensitive?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (attachments.length === 0) return null;
  const single = attachments.length === 1;
  const covered = sensitive && !revealed;
  return (
    <div
      className={[
        'nu-post-media',
        `nu-post-media--count-${attachments.length}`,
        covered && 'nu-post-media--covered',
      ]
        .filter(Boolean)
        .join(' ')}
      data-nu-role="post-media"
    >
      {attachments.map((attachment) => (
        <MediaItem key={attachmentMxc(attachment)} attachment={attachment} single={single} />
      ))}
      {covered && (
        <button type="button" className="nu-post-media__reveal" data-nu-role="post-media-reveal" onClick={() => setRevealed(true)}>
          <Icon name="eyeOff" size={18} />
          Sensitive media
          <span className="nu-post-media__reveal-hint">Show</span>
        </button>
      )}
    </div>
  );
}
