import { useEffect, useState } from 'react';
import { decryptAttachment, type EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useMatrixClient } from '../MatrixClientContext';
import { needsMediaAuthentication } from '../mediaAuth';
import { fetchMedia } from '../mediaFetch';
import { mediaWorkerReady } from '../mediaWorker';
import { serverThumbnail, type ThumbnailSize } from '../thumbnails';

export type AttachmentSource = {
  /** Plain (unencrypted room) attachment: the raw `mxc://` URL. */
  url?: string;
  /** E2EE-encrypted attachment: per-file AES key/iv/hashes plus the `mxc://` URL to fetch. This
   *  is a *separate* layer from the room's own message encryption — the event content JSON is
   *  already decrypted by the time this sees it, but the attached file bytes need their own
   *  decrypt per the Matrix encrypted-attachments spec. */
  file?: EncryptedAttachmentInfo & { url: string };
  mimetype?: string;
};

export type AttachmentOptions = {
  /** For an `<img>`, `<video>` or `<audio>` only: hand back the media URL itself when the service
   *  worker can sign it (matrix/mediaWorker.ts), so video streams and images load lazily and are
   *  cached. Never for a download link: a link to another origin opens rather than saves, and
   *  the worker doesn't sign navigations. Encrypted files always come back as a blob. */
  direct?: boolean;
  /** A thumbnail instead of the whole file (unencrypted images only; see inlineThumbnailSize,
   *  which gives one of the server's own sizes). Falls back to the whole file when the server has
   *  none. */
  thumbnail?: ThumbnailSize;
};

const attachmentUrlCache = new Map<string, Promise<string>>();
/** The same, once resolved: a view drawn again (a room opened again) shows its images on the
 *  first paint instead of a grey box for a frame or more while the promise above settles. */
const resolvedAttachmentUrls = new Map<string, string>();

function cacheKey(mxcUrl: string, direct: boolean, thumbWidth?: number, thumbHeight?: number): string {
  return `${mxcUrl}|${direct ? 'direct' : 'blob'}|${thumbWidth && thumbHeight ? `${thumbWidth}x${thumbHeight}` : 'full'}`;
}

async function blobUrl(
  mx: ReturnType<typeof useMatrixClient>,
  mxcUrl: string,
  httpUrl: string,
  useAuth: boolean,
  source: AttachmentSource
): Promise<string> {
  const res = await fetchMedia(mx, mxcUrl, httpUrl, useAuth);
  const bytes = await res.arrayBuffer();
  const decrypted = source.file ? await decryptAttachment(bytes, source.file) : new Uint8Array(bytes);
  const blob = new Blob([decrypted], { type: source.mimetype });
  return URL.createObjectURL(blob);
}

async function resolveAttachment(
  mx: ReturnType<typeof useMatrixClient>,
  mxcUrl: string,
  source: AttachmentSource,
  options: AttachmentOptions
): Promise<string> {
  const useAuth = await needsMediaAuthentication(mx);
  const full = mx.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, undefined, undefined, useAuth);
  if (!full) throw new Error('Invalid media URL');
  if (source.file) return blobUrl(mx, mxcUrl, full, useAuth, source);

  const thumb = options.thumbnail
    ? mx.mxcUrlToHttp(mxcUrl, options.thumbnail.width, options.thumbnail.height, options.thumbnail.method, undefined, undefined, useAuth)
    : null;
  if (options.direct && (!useAuth || (await mediaWorkerReady()))) return thumb ?? full;
  if (thumb) {
    try {
      return await blobUrl(mx, mxcUrl, thumb, useAuth, source);
    } catch {
      // No thumbnail for this file (or its server makes none): the whole file instead.
    }
  }
  return blobUrl(mx, mxcUrl, full, useAuth, source);
}

/** `name` with an extension from `mimetype` when it has none (`video/mp4` → `.mp4`), so a saved
 *  file opens in the right app. */
export function attachmentFileName(name: string, mimetype?: string): string {
  const base = name.trim() || 'file';
  if (/\.[a-z0-9]{1,5}$/i.test(base) || !mimetype) return base;
  const sub = mimetype.split(';')[0].split('/')[1]?.replace(/^x-/, '');
  const ext = sub === 'quicktime' ? 'mov' : sub === 'mpeg' && mimetype.startsWith('audio/') ? 'mp3' : sub;
  return ext && /^[a-z0-9]{1,5}$/i.test(ext) ? `${base}.${ext}` : base;
}

/**
 * Saves an attachment to the device under `name`. A video or audio player points straight at the
 * media URL, which only works because the service worker adds the token to the player's own
 * requests; the browser's built-in "Download" fetches that URL again without it, and saved the
 * homeserver's 401 error as a `.json` file. This fetches the bytes with the token (decrypting
 * an encrypted file) and saves them instead.
 */
export async function saveAttachment(mx: ReturnType<typeof useMatrixClient>, source: AttachmentSource, name: string): Promise<void> {
  const mxcUrl = source.file?.url ?? source.url;
  if (!mxcUrl) throw new Error('No media URL');
  const url = await resolveAttachment(mx, mxcUrl, source, {});
  const link = document.createElement('a');
  link.href = url;
  link.download = attachmentFileName(name, source.mimetype);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The box an image in a message is drawn in (ImageMessage.tsx; must match .nu-image-message's
 *  max-width/max-height in ImageMessage.css). Here so matrix/mediaWarm.ts asks for the same
 *  thumbnail the timeline will. */
export const INLINE_IMAGE_BOX = { width: 360, height: 320 };

/** Image types whose thumbnail would lose something: animation, or vector sharpness. */
const KEEP_WHOLE = /^image\/(gif|webp|apng|png;\s*animated|svg\+xml)/;

/**
 * The thumbnail for an image shown inline in a box of `boxWidth` × `boxHeight` CSS pixels, or
 * undefined when the whole file should load: a type a thumbnail would flatten (GIF, WebP, which
 * can be animated), or an image no larger than the thumbnail. Twice the box, for sharp images on
 * high-density screens, as one of the server's own thumbnail sizes (matrix/thumbnails.ts): the
 * largest at most, since asking for more got the whole original.
 */
export function inlineThumbnailSize(
  mimetype: string | undefined,
  width: number | undefined,
  height: number | undefined,
  boxWidth: number,
  boxHeight: number
): ThumbnailSize | undefined {
  if (!mimetype || KEEP_WHOLE.test(mimetype)) return undefined;
  const target = serverThumbnail(boxWidth * 2, boxHeight * 2, { capped: true })!;
  if (width && height && width <= target.width && height <= target.height) return undefined;
  return target;
}

/**
 * Resolves a message attachment's `url` (plain) or `file` (encrypted) into a usable src. By
 * default it fetches the bytes itself and hands back a blob URL — required for encrypted
 * attachments, and the only way to attach the access token where the homeserver wants one on
 * media. `options.direct` and `options.thumbnail` (above) make the common case, an unencrypted
 * image or video shown inline, much lighter. A fetch that fails for a reason that may pass
 * (another server slow to answer ours) is asked again a few times (matrix/mediaFetch.ts).
 */
export function useAttachmentUrl(source: AttachmentSource, options: AttachmentOptions = {}): string | null {
  const mx = useMatrixClient();
  const mxcUrl = source.file?.url ?? source.url;
  const direct = !!options.direct;
  const thumbWidth = options.thumbnail?.width;
  const thumbHeight = options.thumbnail?.height;
  const thumbMethod = options.thumbnail?.method;
  const key = mxcUrl ? cacheKey(mxcUrl, direct, thumbWidth, thumbHeight) : null;
  const [state, setState] = useState<{ key: string | null; src: string | null }>(() => ({ key, src: key ? (resolvedAttachmentUrls.get(key) ?? null) : null }));
  // Another file than the one the state holds (the row was reused for another message): what's
  // known about this one, rather than the other's src for a frame.
  const src = state.key === key ? state.src : key ? (resolvedAttachmentUrls.get(key) ?? null) : null;
  const setSrc = (value: string | null) => setState((prev) => (prev.key === key && prev.src === value ? prev : { key, src: value }));

  useEffect(() => {
    if (!mxcUrl || !key) {
      setSrc(null);
      return undefined;
    }
    const known = resolvedAttachmentUrls.get(key);
    if (known) {
      setSrc(known);
      return undefined;
    }

    let cancelled = false;
    const thumbnail = thumbWidth && thumbHeight ? { width: thumbWidth, height: thumbHeight, method: thumbMethod ?? 'scale' } : undefined;
    let cached = attachmentUrlCache.get(key);
    if (!cached) {
      cached = resolveAttachment(mx, mxcUrl, source, { direct, thumbnail }).catch((err: unknown) => {
        attachmentUrlCache.delete(key); // don't poison the cache with a failed attempt
        throw err;
      });
      attachmentUrlCache.set(key, cached);
    }

    cached
      .then((url) => {
        resolvedAttachmentUrls.set(key, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, mxcUrl, source.mimetype, direct, thumbWidth, thumbHeight, thumbMethod]);

  return src;
}
