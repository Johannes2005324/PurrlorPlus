import { useEffect, useRef, useState, type ReactNode } from 'react';
import { currentPositionSeconds, type WatchTogetherState } from './watchTogether';
import type { WatchTogetherControls } from './useWatchTogether';
import { useVoiceCall } from './voiceCallContext';
import { readWatchVolume, saveWatchVolume } from './listenVolume';
import './WatchTogetherPlayer.css';

// The YouTube IFrame Player API has no official TypeScript types shipped with the package this
// app pins — same situation as screenShareKeyframeRequest.worker.ts's ambient Insertable Streams
// types, declared locally rather than pulled in from an extra dependency for a handful of calls.
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  /** Not in YouTube's reference docs, but present on every player and stable for years; used
   *  only to show a title, so its absence costs nothing. */
  getVideoData?(): { title?: string };
  destroy(): void;
};
/** YT.PlayerState values (the IFrame API only ever exposes these as bare numbers). */
const YT_PLAYING = 1;
const YT_BUFFERING = 3;
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, number>;
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;
/** Loads https://www.youtube.com/iframe_api once per page load and resolves once `window.YT` is
 *  actually usable — the script itself loads async and signals readiness via a global callback
 *  (YouTube's own API contract, not something we get to change), so every caller shares one
 *  promise rather than each mounting its own copy of the script tag. */
function loadYoutubeApi(): Promise<void> {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    if (window.YT) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

/** Formats a seconds count as `m:ss` / `h:mm:ss` for the seek bar's time readout. */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type PlaybackInfo = { position: number; duration: number };

/** How loud shared media plays here: 0–1, and whether it's silenced (deafened). Local only —
 *  never broadcast, since everyone's speakers and taste differ. */
type LocalAudio = { volume: number; muted: boolean };

export function YoutubePlayer({
  state,
  videoId,
  registerPlaybackInfo,
  audio,
  onTitle,
  compact = false,
}: {
  state: WatchTogetherState;
  videoId: string;
  registerPlaybackInfo: (getInfo: () => PlaybackInfo) => void;
  audio: LocalAudio;
  onTitle?: (title: string) => void;
  /** The Now playing card's small player, rather than the call pane's full-width one. */
  compact?: boolean;
}) {
  // A *stable* wrapper React owns, plus a throwaway inner div created imperatively for the IFrame
  // API to consume — YouTube's own docs are explicit that it "will replace the specified element
  // with the <iframe>", i.e. it rips the given node out of the DOM entirely. Handing it our real
  // React-managed ref would leave that ref pointing at a detached node the moment a second video
  // gets loaded into the same component instance (changing videos re-runs this effect without
  // unmounting YoutubePlayer) — the next `new YT.Player(containerRef.current, ...)` would then
  // construct into a node that's no longer attached to anything visible. Routing through a
  // disposable inner div, and clearing the wrapper by hand on cleanup regardless of what state
  // the IFrame API left it in, keeps this component's own DOM node stable across video changes.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const [ready, setReady] = useState(false);
  // Set when we've asked the player to play but the browser's autoplay policy silently ignored
  // it (YouTube's IFrame API has no promise-rejection equivalent to <video>.play() for this —
  // onStateChange staying away from PLAYING/BUFFERING after a play attempt is the only signal).
  // Confirmed live: a fresh profile with no prior youtube.com engagement blocks this even though
  // the embed already carries `allow="autoplay"` and the session was started from a real click.
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | undefined;
    // Captured at effect start rather than read in the cleanup: by the time cleanup runs the ref
    // can already point at the next render's node (or at nothing), and clearing the wrong
    // wrapper is exactly the bug the by-hand clearing above exists to prevent.
    const wrapper = wrapperRef.current;
    void loadYoutubeApi().then(() => {
      if (cancelled || !wrapperRef.current || !window.YT) return;
      const target = document.createElement('div');
      wrapperRef.current.appendChild(target);
      player = new window.YT.Player(target, {
        videoId,
        width: '100%',
        height: '100%',
        // controls: 0 and disablekb: 1 keep every participant funneled through this component's
        // own play/pause/seek bar instead of YouTube's native controls — otherwise a click on
        // YouTube's own UI would only affect that one person's view, with nothing to broadcast it.
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => {
            playerRef.current = player ?? null;
            setReady(true);
            const title = player?.getVideoData?.().title;
            if (title) onTitleRef.current?.(title);
          },
          onStateChange: (e) => {
            if (e.data === YT_PLAYING || e.data === YT_BUFFERING) setBlocked(false);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      player?.destroy();
      if (wrapper) wrapper.innerHTML = '';
      playerRef.current = null;
      setReady(false);
    };
    // Only the video ID should ever remount the embed — play/pause/seek are applied to the
    // existing player instance in the effect below instead of tearing it down and back up.
  }, [videoId]);

  useEffect(() => {
    if (!ready) return;
    registerPlaybackInfo(() => ({
      position: playerRef.current?.getCurrentTime() ?? 0,
      duration: playerRef.current?.getDuration() ?? 0,
    }));
  }, [ready, registerPlaybackInfo]);

  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player) return;
    player.setVolume(Math.round(audio.volume * 100));
    if (audio.muted) player.mute();
    else player.unMute();
  }, [ready, audio.volume, audio.muted]);

  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player) return;
    const target = currentPositionSeconds(state);
    if (Math.abs(player.getCurrentTime() - target) > 1.5) {
      player.seekTo(target, true);
    }
    if (state.playing) {
      player.playVideo();
      // A blocked autoplay attempt leaves the player silently paused/cued rather than throwing —
      // give it a moment to actually start (BUFFERING/PLAYING would clear `blocked` via
      // onStateChange above first) before concluding it needs a manual nudge.
      const timeout = setTimeout(() => {
        const s = player.getPlayerState();
        if (s !== YT_PLAYING && s !== YT_BUFFERING) setBlocked(true);
      }, 800);
      return () => clearTimeout(timeout);
    }
    player.pauseVideo();
    return undefined;
  }, [ready, state]);

  return (
    <div className={compact ? 'nu-watch-together__frame nu-watch-together__frame--compact' : 'nu-watch-together__frame'}>
      <div ref={wrapperRef} className="nu-watch-together__youtube-target" />
      {blocked && (
        <button
          type="button"
          className="nu-watch-together__unblock"
          data-nu-role="watch-together-unblock"
          onClick={() => {
            playerRef.current?.playVideo();
            setBlocked(false);
          }}
        >
          ▶ Click to play
        </button>
      )}
    </div>
  );
}

export function MediaPlayer({
  state,
  registerPlaybackInfo,
  audio,
  audioOnly = false,
}: {
  state: WatchTogetherState;
  registerPlaybackInfo: (getInfo: () => PlaybackInfo) => void;
  audio: LocalAudio;
  /** Listen together: play the sound with no picture. An `<audio>` element plays an audio file,
   *  and a video file's soundtrack too. */
  audioOnly?: boolean;
}) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    registerPlaybackInfo(() => ({
      position: mediaRef.current?.currentTime ?? 0,
      duration: mediaRef.current?.duration || 0,
    }));
  }, [registerPlaybackInfo]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = audio.volume;
    media.muted = audio.muted;
  }, [audio.volume, audio.muted]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const target = currentPositionSeconds(state);
    if (Math.abs(media.currentTime - target) > 1.5) {
      media.currentTime = target;
    }
    if (state.playing) {
      media.play().then(
        () => setBlocked(false),
        () => setBlocked(true) // browser autoplay policy — needs a real user gesture to recover
      );
    } else {
      media.pause();
    }
  }, [state]);

  const unblock = (
    <button
      type="button"
      className="nu-watch-together__unblock"
      data-nu-role="watch-together-unblock"
      onClick={() => mediaRef.current?.play().then(() => setBlocked(false))}
    >
      ▶ Click to play
    </button>
  );

  if (audioOnly) {
    return (
      <div className="nu-watch-together__audio" data-nu-role="listen-together-audio">
        {/* No <track>: an arbitrary link someone pasted has no caption file to point at. */}
        <audio ref={mediaRef} src={state.url} preload="auto" />
        {blocked && unblock}
      </div>
    );
  }

  return (
    <div className="nu-watch-together__frame nu-watch-together__frame--media">
      {/* No <track> element: the source is an arbitrary URL someone pasted into the call, so
          there is no caption file to point at. */}
      <video ref={mediaRef} src={state.url} className="nu-watch-together__video" />
      {blocked && unblock}
    </div>
  );
}

/**
 * The play/pause, time, seek and stop controls shared by both ways of sharing. Every change goes
 * through `controls`, which broadcasts it — so one person's pause pauses it for the whole call.
 */
/**
 * "Volume for me": how loud something everyone in the call shares plays on your own speakers.
 * Nobody else's changes. Shown in a shared player's row of controls, before its last button.
 */
export function VolumeSlider({
  value,
  onChange,
  deafened,
  role,
  label,
}: {
  value: number;
  onChange: (volume: number) => void;
  deafened: boolean;
  role: string;
  label: string;
}) {
  return (
    <label className="nu-watch-together__volume" title={deafened ? 'Deafened: you hear nothing in the call' : `${label} (only for you)`}>
      <span aria-hidden="true">{deafened || value === 0 ? '🔇' : value < 0.5 ? '🔉' : '🔊'}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={deafened}
        data-nu-role={role}
        aria-label={`${label} (only for you)`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SharedMediaControls({
  state,
  controls,
  getInfo,
  stopLabel,
  volume,
}: {
  state: WatchTogetherState;
  controls: WatchTogetherControls;
  getInfo: () => PlaybackInfo;
  stopLabel: string;
  /** A "volume for me" slider before the stop button (Watch Together's; the music card has its own). */
  volume?: ReactNode;
}) {
  const [info, setInfo] = useState<PlaybackInfo>({ position: 0, duration: 0 });
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const getInfoRef = useRef(getInfo);
  getInfoRef.current = getInfo;

  useEffect(() => {
    const id = setInterval(() => {
      if (scrubbing === null) setInfo(getInfoRef.current());
    }, 500);
    return () => clearInterval(id);
  }, [scrubbing]);

  // A duration of 0 (not loaded yet) would otherwise make the seek bar's range collapse to
  // nothing right as playback starts — floor it so the bar stays usable during that gap.
  const duration = Math.max(info.duration, info.position, 1);
  const commitSeek = () => {
    if (scrubbing !== null) controls.seek(scrubbing);
    setScrubbing(null);
  };

  return (
    <div className="nu-watch-together__controls" data-nu-role="watch-together-controls">
      <button
        type="button"
        className="nu-watch-together__play-pause"
        data-nu-role="watch-together-play-pause"
        aria-label={state.playing ? 'Pause for everyone' : 'Play for everyone'}
        onClick={() => (state.playing ? controls.pause() : controls.play())}
      >
        {state.playing ? '⏸' : '▶'}
      </button>
      <span className="nu-watch-together__time">
        {formatTime(scrubbing ?? info.position)} / {formatTime(duration)}
      </span>
      <input
        type="range"
        className="nu-watch-together__seek"
        data-nu-role="watch-together-seek"
        aria-label="Seek for everyone"
        min={0}
        max={duration}
        step={1}
        value={scrubbing ?? info.position}
        onChange={(e) => setScrubbing(Number(e.target.value))}
        onMouseUp={commitSeek}
        onTouchEnd={commitSeek}
        onKeyUp={commitSeek}
      />
      {volume}
      <button
        type="button"
        className="nu-watch-together__stop"
        data-nu-role="watch-together-stop"
        title={stopLabel}
        aria-label={stopLabel}
        onClick={controls.stop}
      >
        ✕
      </button>
    </div>
  );
}

/** The call pane's Watch together view: the video, full width, with the shared controls. */
export function WatchTogetherPlayer({
  state,
  controls,
}: {
  state: WatchTogetherState;
  controls: WatchTogetherControls;
}) {
  const getInfoRef = useRef<() => PlaybackInfo>(() => ({ position: 0, duration: 0 }));
  const deafened = useVoiceCall()?.deafened ?? false;
  const [volume, setVolume] = useState(readWatchVolume);
  const audio = { volume, muted: deafened };
  const register = (fn: () => PlaybackInfo) => (getInfoRef.current = fn);

  return (
    <div className="nu-watch-together" data-nu-role="watch-together">
      {state.kind === 'youtube' && state.videoId ? (
        <YoutubePlayer state={state} videoId={state.videoId} registerPlaybackInfo={register} audio={audio} />
      ) : (
        <MediaPlayer state={state} registerPlaybackInfo={register} audio={audio} />
      )}
      <SharedMediaControls
        state={state}
        controls={controls}
        getInfo={() => getInfoRef.current()}
        stopLabel="Stop watching together"
        volume={
          <VolumeSlider
            value={volume}
            deafened={deafened}
            role="watch-together-volume"
            label="Volume for the video"
            onChange={(next) => {
              setVolume(next);
              saveWatchVolume(next);
            }}
          />
        }
      />
    </div>
  );
}
