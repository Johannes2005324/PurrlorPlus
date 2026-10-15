import { useEffect } from 'react';
import { useStore, type Atom, type ExtractAtomValue } from 'jotai';
import { mobileMemberListOpenAtom, mobileSpacesOpenAtom } from './state/mobile';
import {
  globalFeedOpenAtom,
  openPostAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
  socialSpaceIdAtom,
  socialViewAtom,
} from './state/selection';

/**
 * Back goes to the previous screen. What's showing lives in atoms (state/selection.ts), never in
 * the address, so the browser's history had nothing in it: Back left the site, and in the Android
 * app (a Trusted Web Activity, where the system Back button is the browser's) it closed the app.
 * Now each change of view adds a history entry, with the same address, and Back puts the view it
 * stands for back. From the first screen Back still leaves, as it should.
 *
 * The views are kept here, by entry number, not in `history.state`: an open post carries objects
 * a browser can't store there. After a reload they're gone, and Back from there leaves the site.
 */

const NAV_KEY = 'purrlorNav';

/** The atoms that make up "what's showing". */
const VIEW_ATOMS = {
  spaceId: selectedSpaceIdAtom,
  roomId: selectedRoomIdAtom,
  spaceView: selectedSpaceViewAtom,
  globalFeed: globalFeedOpenAtom,
  socialView: socialViewAtom,
  socialSpaceId: socialSpaceIdAtom,
  profileUserId: profileUserIdAtom,
  openPost: openPostAtom,
  mobileSpaces: mobileSpacesOpenAtom,
  mobileMembers: mobileMemberListOpenAtom,
} as const;

type ViewAtoms = typeof VIEW_ATOMS;
export type View = { [K in keyof ViewAtoms]: ExtractAtomValue<ViewAtoms[K]> };

/**
 * Changes this soon after the last entry was made (or a view was put back) amend that entry
 * instead of adding one: one tap sets several atoms, and some views go on to settle by themselves
 * (opening a Space lands on its first channel, matrix/spaceNews.ts). Without it, Back could land
 * on a half-set view, or on one that moves itself forward again and never lets Back past it.
 */
export const SETTLE_MS = 600;

export function sameView(a: View, b: View): boolean {
  return (Object.keys(VIEW_ATOMS) as (keyof View)[]).every((key) => Object.is(a[key], b[key]));
}

type HistoryLike = Pick<History, 'pushState' | 'replaceState' | 'state'>;

/** The history bookkeeping, apart from React and jotai so it can be tested on its own. */
export class NavigationHistory {
  private views: View[] = [];
  private index = 0;
  private lastChange = -Infinity;

  constructor(
    private readonly history: HistoryLike,
    private readonly read: () => View,
    private readonly apply: (view: View) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    this.views = [this.read()];
    this.index = 0;
    this.history.replaceState({ ...(this.history.state as object | null), [NAV_KEY]: 0 }, '');
  }

  /** Something in the view changed: a new entry, or the current one amended (SETTLE_MS). */
  changed(): void {
    const view = this.read();
    if (sameView(view, this.views[this.index])) return;
    const now = this.now();
    if (now - this.lastChange < SETTLE_MS) {
      this.views[this.index] = view;
    } else {
      this.views = this.views.slice(0, this.index + 1);
      this.views.push(view);
      this.index += 1;
      this.history.pushState({ [NAV_KEY]: this.index }, '');
    }
    this.lastChange = now;
  }

  /** Back (or Forward): put that entry's view back. An entry without a number is the first one,
   *  whose state something else replaced (useShareTarget.ts and others tidy the address). */
  popped(state: unknown): void {
    const raw = (state as Record<string, unknown> | null)?.[NAV_KEY];
    const index = typeof raw === 'number' ? raw : 0;
    const view = this.views[index];
    if (!view) return;
    this.index = index;
    this.lastChange = this.now();
    this.apply(view);
  }
}

/** Mounted once, in AppShell. */
export function useNavigationHistory(): void {
  const store = useStore();

  useEffect(() => {
    const keys = Object.keys(VIEW_ATOMS) as (keyof View)[];
    const read = () => Object.fromEntries(keys.map((key) => [key, store.get(VIEW_ATOMS[key] as Atom<unknown>)])) as View;
    let applying = false;
    const apply = (view: View) => {
      applying = true;
      for (const key of keys) store.set(VIEW_ATOMS[key] as never, view[key] as never);
      applying = false;
    };
    const nav = new NavigationHistory(window.history, read, apply);
    nav.start();

    // One look per batch of changes: a tap sets several atoms one after another.
    let queued = false;
    const onChange = () => {
      if (applying || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        nav.changed();
      });
    };
    const unsubscribe = keys.map((key) => store.sub(VIEW_ATOMS[key] as Atom<unknown>, onChange));
    const onPop = (event: PopStateEvent) => nav.popped(event.state);
    window.addEventListener('popstate', onPop);
    return () => {
      unsubscribe.forEach((off) => off());
      window.removeEventListener('popstate', onPop);
    };
  }, [store]);
}
