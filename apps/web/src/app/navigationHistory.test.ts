import { describe, expect, it } from 'vitest';
import { NavigationHistory, SETTLE_MS, type View } from './navigationHistory';

const HOME: View = {
  spaceId: null,
  roomId: null,
  spaceView: null,
  globalFeed: false,
  socialView: 'everyone',
  socialSpaceId: null,
  profileUserId: null,
  openPost: null,
  mobileSpaces: false,
  mobileMembers: false,
};

/** A view, a fake browser history and a clock, as the hook wires them up. */
function setup() {
  let view = HOME;
  let time = 0;
  const entries: unknown[] = [{}];
  let at = 0;
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
  };
  const nav = new NavigationHistory(history as unknown as History, () => view, (v) => (view = v), () => time);
  nav.start();
  return {
    nav,
    go(next: Partial<View>) {
      time += SETTLE_MS + 1;
      view = { ...view, ...next };
      nav.changed();
    },
    settle(next: Partial<View>) {
      time += 10;
      view = { ...view, ...next };
      nav.changed();
    },
    back() {
      at -= 1;
      time += SETTLE_MS + 1;
      nav.popped(entries[at]);
    },
    get view() {
      return view;
    },
    get entries() {
      return entries.length;
    },
  };
}

describe('NavigationHistory', () => {
  it('goes back through the screens, one entry per change of view', () => {
    const t = setup();
    t.go({ spaceId: '!cats', roomId: '!general' });
    t.go({ roomId: '!art' });
    t.go({ profileUserId: '@mochi:purr.example' });
    expect(t.entries).toBe(4);

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
    t.settle({ roomId: '!general' });
    expect(t.entries).toBe(2);

    t.go({ spaceId: '!dogs', roomId: null });
    t.back();
    expect(t.view).toMatchObject({ spaceId: '!cats', roomId: '!general' });
    // A view put back that moves itself on amends its entry rather than adding one.
    t.settle({ roomId: '!news' });
    expect(t.entries).toBe(3);
    t.back();
    expect(t.view).toEqual(HOME);
  });

  it('ignores a change that leaves the view as it was', () => {
    const t = setup();
    t.go({});
    expect(t.entries).toBe(1);
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
