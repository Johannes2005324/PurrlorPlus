import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { MsgType } from 'matrix-js-sdk';
import { usePauseWhenOffscreen } from '../../components/usePauseWhenOffscreen';
import { useAttachmentUrl } from '../../matrix/hooks/useAttachmentUrl';
import { AttachmentDownloadButton } from './AttachmentDownloadButton';
import './FileMessage.css';

type FileMessageProps = {
  msgtype: string;
  body: string;
  url?: string;
  file?: (EncryptedAttachmentInfo & { url: string }) | undefined;
  mimetype?: string;
  size?: number;
};

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders `m.video`/`m.audio`/`m.file` messages sent from the composer's file-upload button
 *  (see matrix/upload.ts) — the counterpart to ImageMessage for every attachment type that
 *  isn't a plain image. Video/audio get an inline native player; anything else gets a download
 *  card. All three go through the same fetch-then-blob path as images (useAttachmentUrl),
 *  which is what makes E2EE attachments transparent here too. */
export function FileMessage({ msgtype, body, url, file, mimetype, size }: FileMessageProps) {
  // A player streams straight from the media URL; a download link needs the file itself.
  const playable = msgtype === MsgType.Video || msgtype === MsgType.Audio;
  const src = useAttachmentUrl({ url, file, mimetype }, { direct: playable });
  const mediaRef = usePauseWhenOffscreen();

  if (!src) {
    return (
      <div className="nu-file-message nu-file-message--loading" data-nu-role="timeline-file">
        Loading {body}…
      </div>
    );
  }

  // The player's own download button is hidden (`nodownload`): it fetches the media URL without
  // the token and saved the server's error as a .json file. Ours fetches it properly.
  if (playable) {
    const player =
      msgtype === MsgType.Video ? (
        <video ref={mediaRef} className="nu-file-message__video" data-nu-role="timeline-file" src={src} controls controlsList="nodownload" />
      ) : (
        <audio ref={mediaRef} className="nu-file-message__audio" data-nu-role="timeline-file" src={src} controls controlsList="nodownload" />
      );
    return (
      <div className="nu-file-message__media">
        {player}
        <AttachmentDownloadButton source={{ url, file, mimetype }} name={body} />
      </div>
    );
  }

  return (
    <a
      className="nu-file-message__card"
      data-nu-role="timeline-file"
      href={src}
      download={body}
    >
      <span className="nu-file-message__icon" aria-hidden="true">
        📄
      </span>
      <span className="nu-file-message__info">
        <span className="nu-file-message__name">{body}</span>
        {size !== undefined && <span className="nu-file-message__size">{formatSize(size)}</span>}
      </span>
    </a>
  );
}
