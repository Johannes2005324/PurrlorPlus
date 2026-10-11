import { useSyncExternalStore } from 'react';

/**
 * IRC mode: everything tighter, for people who'd rather see more channels, more members and more
 * messages at once than have room to breathe. Brought over from Cunny's "IRC-style layout".
 *
 * - The rail narrows to icons only, and the channel and member lists get narrower, shorter rows
 *   with smaller pictures (styles/base/density.css).
 * - Messages lose their spacing: a small picture, the name and time on one line, the text right
 *   under it, and a run of messages from one person stays one group however long it runs
 *   (MessageTimeline.tsx).
 *
 * Kept per device in localStorage, like Effects (app/effects.ts): a big monitor and a laptop want
 * different things. Applied as `data-nu-density` on <html>, before the first render.
 */
export type Density = 'comfortable' | 'irc';

const STORAGE_KEY = 'nekous_density';

export function readDensity(): Density {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'irc' ? 'irc' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

const listeners = new Set<() => void>();

function apply(density: Density): void {
  document.documentElement.dataset.nuDensity = density;
  listeners.forEach((listener) => listener());
}

/** Call once at boot (main.tsx), before React renders, so the roomy layout never shows first. */
export function applyDensityOnLoad(): void {
  apply(readDensity());
}

export function saveDensity(density: Density): void {
  try {
    if (density === 'comfortable') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, density);
  } catch {
    // Applied for this visit even when it can't be kept.
  }
  apply(density);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether IRC mode is on, for components that size things in markup (avatars) or group differently. */
export function useIrcMode(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.nuDensity === 'irc');
}
