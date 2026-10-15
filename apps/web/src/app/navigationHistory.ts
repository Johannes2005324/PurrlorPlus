import { useEffect, useRef } from 'react';
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
 * Back goes to the previous screen, or closes the pop-up on top. What's showing lives in atoms
 * (state/selection.ts), never in the address, so the browser's history had nothing in it: Back
 * left the site, and in the Android app (a Trusted Web Activity, where the system Back button is
 * the browser's) it closed the app. Now each change of view, and each pop-up (Modal, Lightbox)
 * that opens, adds a history entry, with the same address, and Back undoes it. From the first
 * screen Back still leaves, as it should.
 *
 * The views are kept here, by number, not in `history.state`: an open post carries objects a
 * browser can't store there. After a reload they're gone, and Back from there leaves the site.
 */

const NAV_KEY = 'purrlorNav';
const SEQ_KEY = 'purrlorSeq';

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

type HistoryLike = Pick<History, 'pushState' | 'replaceState' | 'state' | 'go'>;
type Layer = { seq: number; close: () => void };

/**
 * The history bookkeeping, apart from React and jotai so it can be tested on its own. Every entry
 * it makes carries a sequence number (which way Back or Forward went) and the number of the view
 * it shows (`views`).
 */
export class NavigationHistory {
  private views: View[] = [];
  private index = 0;
  private seq = 0;
  private nextSeq = 1;
  private lastChange = -Infinity;
  /** Pop-ups open now, oldest first, each with the entry it made. */
  private layers: Layer[] = [];
  /** Entries whose pop-up has closed: Back and Forward step over them. */
  private spent = new Set<number>();
  /** Stepped back off a closed pop-up's entry, and the browser hasn't said it's there yet. */
  private steppingBack = false;
  /** A change of view that came while stepping back, made once the step is done. */
  private changeWaiting = false;

  constructor(
    private readonly history: HistoryLike,
    private readonly read: () => View,
    private readonly apply: (view: View) => void,
    private readonly now: () => number = () => Date.now(),
    /** When to look again after a pop-up closes by itself (tests run it at once). */
    private readonly later: (run: () => void) => void = (run) => void setTimeout(run, 0)
  ) {}

  start(): void {
    this.views = [this.read()];
    this.history.replaceState({ ...(this.history.state as object | null), [NAV_KEY]: 0, [SEQ_KEY]: 0 }, '');
  }

  private push(): void {
    this.seq = this.nextSeq++;
    this.history.pushState({ [NAV_KEY]: this.index, [SEQ_KEY]: this.seq }, '');
  }

  /** Something in the view changed: a new entry, or the current one amended (SETTLE_MS). A
   *  pop-up's entry is never amended: Back from it closes the pop-up, not the view change. */
  changed(): void {
    if (this.steppingBack) {
      this.changeWaiting = true;
      return;
    }
    const view = this.read();
    if (sameView(view, this.views[this.index])) return;
    const now = this.now();
    const onPopup = this.layers.some((layer) => layer.seq === this.seq);
    if (now - this.lastChange < SETTLE_MS && !onPopup) {
      this.views[this.index] = view;
    } else {
      this.views = this.views.slice(0, this.index + 1);
      this.views.push(view);
      this.index += 1;
      this.push();
    }
    this.lastChange = now;
  }

  /** A pop-up opened: an entry Back closes it from. Returns what to pass to `closed`. */
  opened(close: () => void): number {
    this.push();
    this.layers.push({ seq: this.seq, close });
    return this.seq;
  }

  /**
   * A pop-up closed by itself (its close button, Escape, what it did). Its entry is stepped back
   * off if it's still the current one once things settle, so the next Back isn't spent on it;
   * otherwise (the app went somewhere, or another pop-up opened) Back steps over it later.
   */
  closed(seq: number): void {
    const at = this.layers.findIndex((layer) => layer.seq === seq);
    if (at === -1) return; // Back closed it, and already dealt with it.
    this.layers.splice(at, 1);
    this.spent.add(seq);
    this.later(() => {
      if (this.seq !== seq || this.steppingBack) return;
      this.steppingBack = true;
      this.history.go(-1);
    });
  }

  /**
   * Back (or Forward) reached an entry: close the pop-ups opened after it, put its view back, and
   * keep going past an entry whose pop-up is gone. An entry without numbers is the first one,
   * whose state something else replaced (useShareTarget.ts and others tidy the address).
   */
  popped(state: unknown): void {
    const at = (state as Record<string, unknown> | null) ?? {};
    const seq = typeof at[SEQ_KEY] === 'number' ? (at[SEQ_KEY] as number) : 0;
    const index = typeof at[NAV_KEY] === 'number' ? (at[NAV_KEY] as number) : 0;
    const back = seq < this.seq;
    this.seq = seq;

    if (this.steppingBack) {
      // Off a pop-up that closed by itself: the view is already right.
      this.steppingBack = false;
      this.index = index;
      if (this.spent.has(seq)) {
        this.steppingBack = true;
        this.history.go(-1);
        return;
      }
      if (this.changeWaiting) {
        this.changeWaiting = false;
        this.lastChange = -Infinity;
        this.changed();
      }
      return;
    }

    const closing = this.layers.filter((layer) => layer.seq > seq);
    this.layers = this.layers.filter((layer) => layer.seq <= seq);
    for (const layer of closing.reverse()) {
      this.spent.add(layer.seq);
      layer.close();
    }

    const view = this.views[index];
    if (view) {
      this.index = index;
      this.lastChange = this.now();
      if (!sameView(view, this.read())) this.apply(view);
    }
    if (this.spent.has(seq)) this.history.go(back ? -1 : 1);
  }
}

/** The one in use (useNavigationHistory), for pop-ups to register with. */
let active: NavigationHistory | null = null;

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
    active = nav;

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
      if (active === nav) active = null;
    };
  }, [store]);
}

/**
 * For a pop-up (Modal, Lightbox): Back closes it, calling `onClose` as its close button would.
 * Does nothing outside the signed-in app (no AppShell, so no history to join).
 */
export function useBackCloses(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const nav = active;
    if (!nav) return undefined;
    const seq = nav.opened(() => onCloseRef.current());
    return () => nav.closed(seq);
  }, []);
}
