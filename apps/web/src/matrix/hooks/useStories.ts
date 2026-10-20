import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { loadStoryReels, readStoriesSeen, STORIES_SEEN_ACCOUNT_DATA, type StoriesSeen, type StoryReel } from '../stories';

/** How often the people you follow are checked for new stories while Home is open. */
const REFRESH_MS = 2 * 60 * 1000;

export type StoriesState = {
  own?: StoryReel;
  others: StoryReel[];
  seen: StoriesSeen;
  loading: boolean;
  refresh: () => void;
};

/**
 * Your own stories and those of the people you follow (matrix/stories.ts). Profile rooms you
 * aren't in don't sync, so they're read now and every few minutes, and again whenever `refresh` is
 * called (after posting or deleting one). Which ones you've seen follows account data live.
 */
export function useStories(enabled: boolean, following: string[]): StoriesState {
  const mx = useMatrixClient();
  const [reels, setReels] = useState<{ own?: StoryReel; others: StoryReel[] }>({ others: [] });
  const [loading, setLoading] = useState(enabled);
  const [seen, setSeen] = useState(() => readStoriesSeen(mx));
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  // The list's contents, not its identity: useFollows hands back a new array on every change.
  const followingKey = following.join('\n');
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const run = ++latest.current;
    setLoading(true);
    loadStoryReels(mx, followingKey ? followingKey.split('\n') : [])
      .then((next) => {
        if (run === latest.current) setReels(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });
  }, [mx, enabled, followingKey, tick]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  useEffect(() => {
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === STORIES_SEEN_ACCOUNT_DATA) setSeen(readStoriesSeen(mx));
    };
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx]);

  return { ...reels, seen, loading, refresh };
}
