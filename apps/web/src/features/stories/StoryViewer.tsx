import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackCloses } from '../../app/navigationHistory';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useAttachmentUrl } from '../../matrix/hooks/useAttachmentUrl';
import { deleteStory, markStoriesSeen, type Story, type StoryReel } from '../../matrix/stories';
import { formatPostTime } from '../feed/formatPostTime';

/** How long a picture or a text story stays up before the next one. */
const STILL_MS = 5000;

function StoryMedia({ story, paused, onProgress, onEnded }: { story: Story; paused: boolean; onProgress: (fraction: number) => void; onEnded: () => void }) {
  const attachment = story.content.attachments?.[0];
  const src = useAttachmentUrl({ url: attachment?.url, file: attachment?.file, mimetype: attachment?.info.mimetype }, { direct: true });
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = attachment?.kind === 'video';
  // A still (or text) counts up on a timer; a video by its own playback.
  const elapsed = useRef(0);

  useEffect(() => {
    elapsed.current = 0;
  }, [story.eventId]);

  useEffect(() => {
    if (isVideo || paused || (attachment && !src)) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      elapsed.current += now - last;
      last = now;
      onProgress(Math.min(1, elapsed.current / STILL_MS));
      if (elapsed.current >= STILL_MS) onEnded();
      else frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [isVideo, paused, attachment, src, onProgress, onEnded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [paused, src]);

  if (!attachment) return null;
  if (!src) return <div className="nu-story-viewer__media nu-story-viewer__media--loading" />;
  if (isVideo) {
    return (
      <video
        ref={videoRef}
        className="nu-story-viewer__media"
        src={src}
        autoPlay
        playsInline
        onTimeUpdate={(evt) => {
          const { currentTime, duration } = evt.currentTarget;
          if (duration) onProgress(currentTime / duration);
        }}
        onEnded={onEnded}
      />
    );
  }
  return <img className="nu-story-viewer__media" src={src} alt="" />;
}

/**
 * Watching stories, full screen: one reel after another from where you opened, a bar per story
 * up top. Tap the left of the screen to go back, anywhere else to go on; hold to pause. Arrow
 * keys, Escape and Back work too. Your own story can be deleted from here.
 */
export function StoryViewer({
  reels,
  startReel,
  startStory,
  onClose,
  onDeleted,
}: {
  reels: StoryReel[];
  startReel: number;
  startStory: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const mx = useMatrixClient();
  const me = mx.getUserId();
  const [position, setPosition] = useState({ reel: Math.max(0, startReel), story: startStory });
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const watched = useRef<Story[]>([]);
  // A press long enough to be a hold doesn't also count as a tap.
  const pressedAt = useRef(0);

  const reel = reels[position.reel];
  const stories = reel?.stories.filter((story) => !deleted.has(story.eventId)) ?? [];
  const story = stories[Math.min(position.story, stories.length - 1)];
  const own = reel?.userId === me;

  const close = useCallback(() => {
    // Your own stories don't need marking.
    const others = watched.current.filter((item) => !reels.some((r) => r.userId === me && r.stories.includes(item)));
    if (others.length) void markStoriesSeen(mx, others).catch(() => undefined);
    onClose();
  }, [mx, me, reels, onClose]);
  useBackCloses(close);

  useEffect(() => {
    if (story && !watched.current.includes(story)) watched.current.push(story);
    setProgress(0);
  }, [story]);

  const next = useCallback(() => {
    setPosition((at) => {
      const count = reels[at.reel]?.stories.filter((item) => !deleted.has(item.eventId)).length ?? 0;
      if (at.story + 1 < count) return { reel: at.reel, story: at.story + 1 };
      if (at.reel + 1 < reels.length) return { reel: at.reel + 1, story: 0 };
      return at;
    });
  }, [reels, deleted]);

  const previous = useCallback(() => {
    setPosition((at) => {
      if (at.story > 0) return { reel: at.reel, story: at.story - 1 };
      if (at.reel > 0) return { reel: at.reel - 1, story: Math.max(0, reels[at.reel - 1].stories.length - 1) };
      return at;
    });
  }, [reels]);

  // Past the last story of the last reel, the viewer closes.
  const isLast = position.reel === reels.length - 1 && position.story >= stories.length - 1;
  const ended = useCallback(() => (isLast ? close() : next()), [isLast, close, next]);

  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') close();
      else if (evt.key === 'ArrowRight') ended();
      else if (evt.key === 'ArrowLeft') previous();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, ended, previous]);

  useEffect(() => {
    if (!story) close();
  }, [story, close]);

  if (!reel || !story) return null;

  const remove = async () => {
    setHeld(true);
    try {
      await deleteStory(mx, story.roomId, story.eventId);
      setDeleted((current) => new Set(current).add(story.eventId));
      onDeleted();
    } catch {
      // Left in place; it can be tried again.
    } finally {
      setHeld(false);
    }
  };

  const textOnly = !story.content.attachments?.length;
  const viewer = (
    <div className="nu-story-viewer" data-nu-role="story-viewer" role="dialog" aria-modal="true" aria-label={`${reel.name}'s story`}>
      <div className="nu-story-viewer__frame">
        <div className="nu-story-viewer__bars">
          {stories.map((item, index) => (
            <span key={item.eventId} className="nu-story-viewer__bar">
              <span
                className="nu-story-viewer__bar-fill"
                style={{ width: `${index < position.story ? 100 : index === position.story ? progress * 100 : 0}%` }}
              />
            </span>
          ))}
        </div>
        <div className="nu-story-viewer__header">
          <Avatar name={reel.name} mxcUrl={reel.avatarUrl ?? null} size={32} />
          <span className="nu-story-viewer__name">{own ? 'Your story' : reel.name}</span>
          <span className="nu-story-viewer__time">{formatPostTime(story.ts)}</span>
          {own && (
            <button type="button" className="nu-story-viewer__button" data-nu-role="story-delete" aria-label="Delete this story" onClick={() => void remove()}>
              <Icon name="trash" size={18} />
            </button>
          )}
          <button type="button" className="nu-story-viewer__button" data-nu-role="story-close" aria-label="Close" onClick={close}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <div
          className={textOnly ? 'nu-story-viewer__stage nu-story-viewer__stage--text' : 'nu-story-viewer__stage'}
          onPointerDown={() => {
            pressedAt.current = Date.now();
            setHeld(true);
          }}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onClick={(evt) => {
            if (Date.now() - pressedAt.current > 300) return;
            const box = evt.currentTarget.getBoundingClientRect();
            if (evt.clientX - box.left < box.width / 3) previous();
            else ended();
          }}
        >
          <StoryMedia key={story.eventId} story={story} paused={held} onProgress={setProgress} onEnded={ended} />
          {story.content.body && (
            <p className={textOnly ? 'nu-story-viewer__text' : 'nu-story-viewer__caption'}>{story.content.body}</p>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(viewer, document.getElementById('portalContainer') ?? document.body);
}
