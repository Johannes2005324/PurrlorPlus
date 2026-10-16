/**
 * Your own volume for shared media, never sent to anyone: everyone's speakers and taste differ.
 * Each kind is remembered on this device separately.
 *
 * - Music: Listen Together's card and a profile page's music block share it, so turning it down
 *   in one stays down in the other. 0.6 until you've chosen.
 * - Watch Together's video, and the sound of someone's screen share: full until you've chosen.
 */
const LISTEN_KEY = 'nekous_listen_together_volume';
const WATCH_KEY = 'nekous_watch_together_volume';
const SHARE_KEY = 'nekous_screen_share_volume';

function readVolume(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 && stored <= 1 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function saveVolume(key: string, volume: number): void {
  try {
    localStorage.setItem(key, String(volume));
  } catch {
    // Not remembered this time; it still applies now.
  }
}

export const readListenVolume = (): number => readVolume(LISTEN_KEY, 0.6);
export const saveListenVolume = (volume: number): void => saveVolume(LISTEN_KEY, volume);
export const readWatchVolume = (): number => readVolume(WATCH_KEY, 1);
export const saveWatchVolume = (volume: number): void => saveVolume(WATCH_KEY, volume);
export const readShareVolume = (): number => readVolume(SHARE_KEY, 1);
export const saveShareVolume = (volume: number): void => saveVolume(SHARE_KEY, volume);
