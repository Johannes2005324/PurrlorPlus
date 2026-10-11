import { describe, expect, it } from 'vitest';
import { emptyProfilePage, LIMITS, parseProfilePage, type ProfilePage } from '../../matrix/profilePage';
import {
  addBlock,
  canAddBlock,
  canAddType,
  columnBlocks,
  findEmote,
  galleryPieceCount,
  imageCount,
  moveBlock,
  readabilityProblems,
  removeBlock,
  setBlockSide,
  STARTER_PAGES,
  withFormattedText,
} from './editorModel';

const withBlocks = (...types: Parameters<typeof addBlock>[1][]) => types.reduce((page, type) => addBlock(page, type), emptyProfilePage());

describe('editorModel', () => {
  it('adds blocks at the end with fresh IDs', () => {
    const page = withBlocks('text', 'links', 'divider');
    expect(page.blocks.map((block) => block.type)).toEqual(['text', 'links', 'divider']);
    expect(new Set(page.blocks.map((block) => block.id)).size).toBe(3);
  });

  it('moves a block up and down, and not past either end', () => {
    const page = withBlocks('text', 'image', 'divider');
    const [a, b, c] = page.blocks.map((block) => block.id);
    expect(moveBlock(page, c, -1).blocks.map((block) => block.id)).toEqual([a, c, b]);
    expect(moveBlock(page, a, -1)).toBe(page);
    expect(moveBlock(page, c, 1)).toBe(page);
    expect(removeBlock(page, b).blocks.map((block) => block.id)).toEqual([a, c]);
  });

  it('moves a block within its own column, past the other column’s blocks', () => {
    // text and image go left, friends and guestbook right, by their kind.
    const page = withBlocks('text', 'friends', 'image', 'guestbook');
    const [text, friends, image, guestbook] = page.blocks.map((block) => block.id);
    expect(moveBlock(page, image, -1).blocks.map((block) => block.id)).toEqual([image, friends, text, guestbook]);
    expect(moveBlock(page, friends, 1).blocks.map((block) => block.id)).toEqual([text, guestbook, image, friends]);
    expect(moveBlock(page, guestbook, 1)).toBe(page);
  });

  it('moves a block to the end of the other column', () => {
    const page = withBlocks('text', 'friends', 'image');
    const [text, friends, image] = page.blocks.map((block) => block.id);
    const moved = setBlockSide(page, text, 'right');
    expect(columnBlocks(moved, 'right').map((block) => block.id)).toEqual([friends, text]);
    expect(columnBlocks(moved, 'left').map((block) => block.id)).toEqual([image]);
  });

  it('has room for one profile song, in no column', () => {
    const page = withBlocks('song');
    expect(page.blocks[0].side).toBeUndefined();
    expect(canAddType(page, 'song')).toBe(false);
    expect(canAddType(page, 'text')).toBe(true);
  });

  it('stops offering blocks at the limit', () => {
    let page = emptyProfilePage();
    for (let i = 0; i < LIMITS.blocks; i++) page = addBlock(page, 'divider');
    expect(canAddBlock(page)).toBe(false);
  });

  it('counts images, the background included, but not gallery pieces (they load when their album opens)', () => {
    const page: ProfilePage = {
      ...emptyProfilePage(),
      style: { ...emptyProfilePage().style, background: { kind: 'image', url: 'mxc://s/bg', fit: 'cover' } },
      blocks: [
        { id: 'a', type: 'image', url: 'mxc://s/a' },
        { id: 'b', type: 'image', url: '' },
        { id: 'c', type: 'gallery', ratings: false, albums: [{ id: 'x', title: 'X', pieces: [{ url: 'mxc://s/1', tags: [], rating: 'general' }] }] },
      ],
    };
    expect(imageCount(page)).toBe(2);
  });

  it('counts gallery pieces across every gallery block, since the limit is page-wide', () => {
    const piece = (n: number) => ({ url: `mxc://s/${n}`, tags: [], rating: 'general' as const });
    const page: ProfilePage = {
      ...emptyProfilePage(),
      blocks: [
        { id: 'a', type: 'gallery', ratings: false, albums: [{ id: 'x', title: 'X', pieces: [piece(1), piece(2)] }, { id: 'y', title: 'Y', pieces: [piece(3)] }] },
        { id: 'b', type: 'gallery', ratings: false, albums: [{ id: 'z', title: 'Z', pieces: [piece(4)] }] },
        { id: 'c', type: 'image', url: 'mxc://s/a' },
      ],
    };
    expect(galleryPieceCount(page)).toBe(4);
  });

  it('works out text formatting from the author’s emotes', () => {
    const page: ProfilePage = { ...emptyProfilePage(), blocks: [{ id: 't', type: 'text', body: 'hi :cat:' }] };
    const formatted = withFormattedText(page, [{ shortcode: 'cat', mxcUrl: 'mxc://s/cat' }]);
    const block = formatted.blocks[0];
    expect(block.type === 'text' && block.formatted).toContain('mxc://s/cat');
    // …and drops a stale one when the text has nothing to format any more.
    const plain = withFormattedText({ ...page, blocks: [{ id: 't', type: 'text', body: 'hi', formatted: 'old' }] }, []);
    expect(plain.blocks[0]).toEqual({ id: 't', type: 'text', body: 'hi' });
  });

  it('flags text that is hard to read', () => {
    const style = emptyProfilePage().style;
    expect(readabilityProblems(style)).toEqual([]);
    expect(readabilityProblems({ ...style, colors: { ...style.colors, text: '#111111' } })).toEqual(['background', 'blocks']);
    // A see-through block isn't judged as if it were solid.
    expect(readabilityProblems({ ...style, blockOpacity: 0.4, colors: { ...style.colors, block: '#f4effa' } })).toEqual([]);
  });

  it('finds an emote by shortcode, with or without colons', () => {
    const emotes = [{ shortcode: 'cat', mxcUrl: 'mxc://s/cat' }];
    expect(findEmote(emotes, ':cat:')?.mxcUrl).toBe('mxc://s/cat');
    expect(findEmote(emotes, 'cat')?.mxcUrl).toBe('mxc://s/cat');
    expect(findEmote(emotes, 'dog')).toBeUndefined();
    expect(findEmote(emotes, '')).toBeUndefined();
  });

  it('has starter looks the parser keeps exactly as they are', () => {
    for (const starter of STARTER_PAGES) {
      expect(parseProfilePage({ version: 1, style: starter.style, blocks: [] })?.style).toEqual(starter.style);
    }
  });
});
