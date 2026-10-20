import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { globalFeedOpenAtom, railSectionAtom } from './selection';

describe('globalFeedOpenAtom', () => {
  it('opens on Home, with the feed closed', () => {
    const store = createStore();
    expect(store.get(railSectionAtom)).toBe('home');
    expect(store.get(globalFeedOpenAtom)).toBe(false);
  });

  it('opening the feed moves to the feed section', () => {
    const store = createStore();
    store.set(globalFeedOpenAtom, true);
    expect(store.get(railSectionAtom)).toBe('feed');
    expect(store.get(globalFeedOpenAtom)).toBe(true);
  });

  it('closing the feed lands in Messages', () => {
    const store = createStore();
    store.set(railSectionAtom, 'feed');
    store.set(globalFeedOpenAtom, false);
    expect(store.get(railSectionAtom)).toBe('messages');
  });

  it('closing a feed that is not open leaves the section alone', () => {
    const store = createStore();
    store.set(globalFeedOpenAtom, false);
    expect(store.get(railSectionAtom)).toBe('home');
    store.set(railSectionAtom, 'messages');
    store.set(globalFeedOpenAtom, false);
    expect(store.get(railSectionAtom)).toBe('messages');
  });
});
