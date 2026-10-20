import { describe, expect, it } from 'vitest';
import { NavigationHistory, SETTLE_MS, type View } from './navigationHistory';

const HOME: View = {
  spaceId: null,
  roomId: null,
  spaceView: null,
  railSection: 'messages',
  socialView: 'everyone',
  socialSpaceId: null,
  profileUserId: null,
  openPost: null,
  mobileSpaces: false,
  mobileMembers: false,
};

/**
 * A view, a fake browser history and a clock, as the hook wires them up. Like a browser's,
 * `go` moves later: `settle()` runs what's waiting (the browser's traversal, and the pop-up's
 * look after it closes), as the page's event loop would.
 */
function setup() {
  let view = HOME;
  let time = 0;
  const entries: unknown[] = [{}];
  let at = 0;
  const waiting: (() => void)[] = [];
  const history = {
    get state() {
      return entries[at];
    },
    pushState(state: unknown) {
      entries.splice(at + 1, entries.length, state);
      at += 1;
    },
    replaceState(state: unknown) {
      entries[at] = state;
    },
    go(delta: number) {
      waiting.push(() => {
        at += delta;
        nav.popped(entries[at]);
      });
    },
  };
  const nav: NavigationHistory = new NavigationHistory(
    history as unknown as History,
    () => view,
    (v) => (view = v),
    () => time,
    (run) => waiting.push(run)
  );
  nav.start();
  const settle = () => {
    while (waiting.length) waiting.shift()!();
  };
  return {
    nav,
    settle,
    /** The person goes somewhere. */
    go(next: Partial<View>) {
      time += SETTLE_MS + 1;
      view = { ...view, ...next };
      nav.changed();
      settle();
    },
    /** The view moves on by itself, straight after. */
    drift(next: Partial<View>) {
      time += 10;
      view = { ...view, ...next };
      nav.changed();
    },
    back() {
      time += SETTLE_MS + 1;
      history.go(-1);
      settle();
    },
    get view() {
      return view;
    },
    /** How many entries Back can reach, counting the current one. */
    get position() {
      return at + 1;
    },
  };
}

/** A pop-up as Modal opens one: open, and later closed by itself (or by Back). */
function popup(t: ReturnType<typeof setup>) {
  const state = { open: true, seq: 0 };
  state.seq = t.nav.opened(() => (state.open = false));
  return {
    get open() {
      return state.open;
    },
    closeItself() {
      state.open = false;
      t.nav.closed(state.seq);
    },
  };
}

describe('NavigationHistory: screens', () => {
  it('goes back through the screens, one entry per change of view', () => {
    const t = setup();
    t.go({ spaceId: '!cats', roomId: '!general' });
    t.go({ roomId: '!art' });
    t.go({ profileUserId: '@mochi:purr.example' });
    expect(t.position).toBe(4);

    t.back();
    expect(t.view).toMatchObject({ roomId: '!art', profileUserId: null });
    t.back();
    expect(t.view).toMatchObject({ roomId: '!general' });
    t.back();
    expect(t.view).toEqual(HOME);
  });

  it('makes one entry of a view that settles by itself, so Back passes it', () => {
    const t = setup();
    t.go({ spaceId: '!cats' });
    // Opening the Space lands on its first channel a moment later.
    t.drift({ roomId: '!general' });
    expect(t.position).toBe(2);

    t.go({ spaceId: '!dogs', roomId: null });
    t.back();
    expect(t.view).toMatchObject({ spaceId: '!cats', roomId: '!general' });
    // A view put back that moves itself on amends its entry rather than adding one.
    t.drift({ roomId: '!news' });
    expect(t.position).toBe(2);
    t.back();
    expect(t.view).toEqual(HOME);
  });

  it('ignores a change that leaves the view as it was', () => {
    const t = setup();
    t.go({});
    expect(t.position).toBe(1);
  });

  it('drops the screens ahead when going somewhere new after Back', () => {
    const t = setup();
    t.go({ roomId: '!a' });
    t.go({ roomId: '!b' });
    t.back();
    t.go({ roomId: '!c' });
    t.back();
    expect(t.view).toMatchObject({ roomId: '!a' });
  });
});

describe('NavigationHistory: pop-ups', () => {
  it('closes the pop-up on Back, and leaves the screen under it as it was', () => {
    const t = setup();
    t.go({ roomId: '!general' });
    const settings = popup(t);
    t.back();
    expect(settings.open).toBe(false);
    expect(t.view).toMatchObject({ roomId: '!general' });
    t.back();
    expect(t.view).toEqual(HOME);
  });

  it('spends no Back on a pop-up that closed by itself', () => {
    const t = setup();
    t.go({ roomId: '!general' });
    const settings = popup(t);
    settings.closeItself();
    t.settle();
    expect(t.position).toBe(2);
    t.back();
    expect(t.view).toEqual(HOME);
  });

  it('goes back past a pop-up that closed by taking you somewhere', () => {
    const t = setup();
    t.go({ roomId: '!general' });
    const search = popup(t);
    // A search result: the room opens and the pop-up closes, together.
    search.closeItself();
    t.go({ roomId: '!art' });
    expect(t.view).toMatchObject({ roomId: '!art' });
    t.back();
    expect(t.view).toMatchObject({ roomId: '!general' });
    t.back();
    expect(t.view).toEqual(HOME);
  });

  it('closes the top pop-up first when one opened over another', () => {
    const t = setup();
    const settings = popup(t);
    const confirm = popup(t);
    t.back();
    expect([settings.open, confirm.open]).toEqual([true, false]);
    t.back();
    expect(settings.open).toBe(false);
  });

  it("copes with a pop-up opened twice at once (React's StrictMode, in development)", () => {
    const t = setup();
    t.go({ roomId: '!general' });
    const first = popup(t);
    first.closeItself();
    const second = popup(t);
    t.settle();
    t.back();
    expect(second.open).toBe(false);
    expect(t.view).toMatchObject({ roomId: '!general' });
    t.back();
    expect(t.view).toEqual(HOME);
  });
});
