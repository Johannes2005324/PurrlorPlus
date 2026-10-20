import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { PageBlock } from '../../matrix/profilePage';
import { parseWatchUrl } from '../voice/watchTogether';
import { linkDomain } from './pageStyle';

type SongBlock = Extract<PageBlock, { type: 'song' }>;

/**
 * The profile song, in a small window floating over the corner of the profile rather than a block
 * of its own. Nothing loads until the visitor presses play: no autoplay, and no request to YouTube
 * or the file's host before then. Playing a YouTube song opens the window up to the video, which
 * stays at least 200px tall, as YouTube's terms ask (see watchTogether.ts); a sound file plays in
 * the window's own small player. ✕ closes it for this visit to the profile.
 *
 * Portaled out of the page: the page's frame contains its layout, which would pin a fixed-position
 * window to the page instead of the screen. Out there, hiding the profile didn't hide it: a post
 * opened over the profile, or a phone's Chat column over the whole page, left the window on top.
 * A marker left in the page says whether the profile is showing, and the window goes with it
 * (still playing, so the song carries on when you come back).
 */
export function FloatingSong({ block, accent }: { block: SongBlock; accent?: string }) {
  const [playing, setPlaying] = useState(false);
  const [closed, setClosed] = useState(false);
  const markerRef = useRef<HTMLSpanElement>(null);
  const [pageShown, setPageShown] = useState(true);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || typeof ResizeObserver === 'undefined') return undefined;
    // No boxes at all once anything around the page is display: none.
    const check = () => setPageShown(marker.getClientRects().length > 0);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  const source = parseWatchUrl(block.url);
  const videoId = source?.kind === 'youtube' && /^[\w-]{6,20}$/.test(source.videoId) ? source.videoId : undefined;
  if (closed || !source || (source.kind === 'youtube' && !videoId)) return null;
  const title = block.title ?? 'Profile song';
  const portal = typeof document !== 'undefined' ? (document.getElementById('portalContainer') ?? document.body) : null;
  if (!portal) return null;
  const className = ['nu-floating-song', playing && videoId && 'nu-floating-song--video', !pageShown && 'nu-floating-song--away']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <span ref={markerRef} className="nu-floating-song__marker" aria-hidden="true" />
      {createPortal(
        <div
          className={className}
          style={accent ? ({ '--song-accent': accent } as CSSProperties) : undefined}
          role="region"
          aria-label={title}
          data-nu-role="profile-song"
        >
          <div className="nu-floating-song__bar">
            {!playing && (
              <button
                type="button"
                className="nu-floating-song__play"
                aria-label={`Play ${title}`}
                onClick={() => setPlaying(true)}
                data-nu-role="profile-page-play"
              >
                ▶
              </button>
            )}
            <span className="nu-floating-song__text">
              <span className="nu-floating-song__title">♪ {title}</span>
              <span className="nu-floating-song__source">{linkDomain(block.url)}</span>
            </span>
            <button type="button" className="nu-floating-song__close" aria-label="Close the profile song" onClick={() => setClosed(true)}>
              ✕
            </button>
          </div>
          {playing &&
            (videoId ? (
              <iframe
                className="nu-floating-song__video"
                src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
                title={title}
                allow="autoplay; encrypted-media"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <audio className="nu-floating-song__audio" src={block.url} controls autoPlay />
            ))}
        </div>,
        portal
      )}
    </>
  );
}
