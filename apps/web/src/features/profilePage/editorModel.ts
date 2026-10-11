import type { Emote } from '../../matrix/emotes';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import {
  contrastRatio,
  DEFAULT_PAGE_STYLE,
  defaultSide,
  LIMITS,
  musicTrackCount,
  newBlockId,
  READABLE_CONTRAST,
  type PageBlock,
  type PageBlockType,
  type PageSide,
  type PageStyle,
  type ProfilePage,
} from '../../matrix/profilePage';

/**
 * The page builder's plain logic, kept apart from its controls so it can be tested on its own.
 * The builder edits a ProfilePage that may be half-finished (an empty text block, a link with no
 * address yet); `parseProfilePage` drops what isn't finished when the page is drawn or published.
 */

export type StarterPage = { id: string; label: string; style: PageStyle };

/** Starting looks, one per app theme (Account Settings → Appearance), in the same colours. */
export const STARTER_PAGES: StarterPage[] = [
  { id: 'nightfur', label: 'Nightfur', style: DEFAULT_PAGE_STYLE },
  {
    id: 'y2k',
    label: 'Y2K Chatroom',
    style: {
      colors: { bg: '#170a22', text: '#fdf5ff', accent: '#ff2f92', link: '#4be0ff', block: '#2a1640' },
      background: { kind: 'gradient', from: '#3a0f5c', to: '#062a46', angle: 160 },
      fonts: { heading: 'rounded', body: 'rounded' },
      corners: 16,
      border: 'glow',
      borderColor: '#00e0ff',
      blockOpacity: 0.85,
      columns: 1,
      effect: 'sparkles',
    },
  },
  {
    id: 'lola',
    label: 'Lola',
    style: {
      colors: { bg: '#0a0508', text: '#fff3f8', accent: '#ff1f8f', link: '#ff7ab8', block: '#180e15' },
      background: { kind: 'gradient', from: '#2a0618', to: '#0a0508', angle: 180 },
      fonts: { heading: 'handwriting', body: 'figtree' },
      corners: 20,
      border: 'solid',
      borderColor: '#3a1f2c',
      blockOpacity: 0.9,
      columns: 1,
      effect: 'hearts',
    },
  },
];

export const BLOCK_LABELS: Record<PageBlockType, string> = {
  text: 'Text',
  links: 'Link buttons',
  image: 'Image or GIF',
  gallery: 'Gallery',
  song: 'Profile song',
  spaces: 'Spaces',
  divider: 'Divider',
  friends: 'Top 8 friends',
  guestbook: 'Guestbook',
  commissions: 'Commissions',
  music: 'Music',
};

/** A new, empty block of a kind, at the end of a column (the profile song has no column). */
export function addBlock(page: ProfilePage, type: PageBlockType, side: PageSide = defaultSide(type)): ProfilePage {
  const id = newBlockId(page.blocks);
  const block: PageBlock = (() => {
    switch (type) {
      case 'text':
        return { id, type, body: '' };
      case 'links':
        return { id, type, items: [{ label: '', url: '' }] };
      case 'image':
        return { id, type, url: '' };
      case 'gallery':
        return { id, type, albums: [], ratings: false };
      case 'song':
        return { id, type, url: '' };
      case 'spaces':
        return { id, type, spaces: [] };
      case 'divider':
        return { id, type, style: 'line' };
      case 'friends':
        return { id, type, users: [] };
      case 'guestbook':
        return { id, type, who: 'everyone', slowmode: 0, blockedWords: [] };
      case 'commissions':
        return { id, type };
      case 'music':
        // Ready for its first tracks: uploading goes into an album.
        return { id, type, albums: [{ id: 'a0', tracks: [] }] };
    }
  })();
  return { ...page, blocks: [...page.blocks, type === 'song' ? block : { ...block, side }] };
}

/** Whether another block of this kind fits: a page has one profile song. */
export function canAddType(page: ProfilePage, type: PageBlockType): boolean {
  return type !== 'song' || !page.blocks.some((block) => block.type === 'song');
}

/** The column a block is in (the song is in none). */
export function sideOf(block: PageBlock): PageSide | undefined {
  return block.type === 'song' ? undefined : (block.side ?? defaultSide(block.type));
}

/** A column's blocks, in page order. */
export function columnBlocks(page: ProfilePage, side: PageSide): PageBlock[] {
  return page.blocks.filter((block) => sideOf(block) === side);
}

/** Up or down within its own column, past the blocks of the other one. */
export function moveBlock(page: ProfilePage, id: string, delta: -1 | 1): ProfilePage {
  const from = page.blocks.findIndex((block) => block.id === id);
  if (from < 0) return page;
  const side = sideOf(page.blocks[from]);
  let to = from + delta;
  while (to >= 0 && to < page.blocks.length && sideOf(page.blocks[to]) !== side) to += delta;
  if (to < 0 || to >= page.blocks.length) return page;
  const blocks = [...page.blocks];
  [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
  return { ...page, blocks };
}

/** To the other column, at its end. */
export function setBlockSide(page: ProfilePage, id: string, side: PageSide): ProfilePage {
  const block = page.blocks.find((b) => b.id === id);
  if (!block || block.type === 'song' || sideOf(block) === side) return page;
  const rest = page.blocks.filter((b) => b.id !== id);
  const lastOfSide = rest.reduce((last, b, index) => (sideOf(b) === side ? index : last), -1);
  const blocks = [...rest];
  blocks.splice(lastOfSide + 1, 0, { ...block, side });
  return { ...page, blocks };
}

export function removeBlock(page: ProfilePage, id: string): ProfilePage {
  return { ...page, blocks: page.blocks.filter((block) => block.id !== id) };
}

export function updateBlock(page: ProfilePage, next: PageBlock): ProfilePage {
  return { ...page, blocks: page.blocks.map((block) => (block.id === next.id ? next : block)) };
}

export function canAddBlock(page: ProfilePage): boolean {
  return page.blocks.length < LIMITS.blocks;
}

/** Tracks across the page's music blocks, against LIMITS.tracks. */
export function trackCount(page: ProfilePage): number {
  return page.blocks.reduce((count, block) => count + (block.type === 'music' ? musicTrackCount(block) : 0), 0);
}

/** Music albums across the page, against LIMITS.musicAlbums. */
export function musicAlbumCount(page: ProfilePage): number {
  return page.blocks.reduce((count, block) => count + (block.type === 'music' ? block.albums.length : 0), 0);
}

/** Pieces across the page's gallery blocks, against LIMITS.galleryPieces. */
export function galleryPieceCount(page: ProfilePage): number {
  return page.blocks.reduce(
    (count, block) => count + (block.type === 'gallery' ? block.albums.reduce((sum, album) => sum + album.pieces.length, 0) : 0),
    0
  );
}

/** Images on the page now, the background included, against LIMITS.images. */
export function imageCount(page: ProfilePage): number {
  const background = page.style.background.kind === 'image' ? 1 : 0;
  return page.blocks.reduce((count, block) => count + (block.type === 'image' && block.url ? 1 : 0), background);
}

/**
 * Text blocks carry the same formatting a message does (emotes, bold, spoilers…), worked out
 * from the author's emotes when the page is saved, so visitors see the emotes without having them.
 */
export function withFormattedText(page: ProfilePage, emotes: Emote[]): ProfilePage {
  return {
    ...page,
    blocks: page.blocks.map((block) => {
      if (block.type !== 'text') return block;
      const { formattedBody } = buildMessageFormatting(block.body, emotes, []);
      const { formatted: _old, ...rest } = block;
      return formattedBody ? { ...rest, formatted: formattedBody } : rest;
    }),
  };
}

/** Where the page's text is hard to read: on the page background, or on the blocks. */
export function readabilityProblems(style: PageStyle): ('background' | 'blocks')[] {
  const problems: ('background' | 'blocks')[] = [];
  // A background image or gradient can be anything; only a plain colour is checked.
  if (style.background.kind === 'color' && contrastRatio(style.colors.text, style.colors.bg) < READABLE_CONTRAST) {
    problems.push('background');
  }
  // See-through blocks show the page through them; mostly-solid ones are checked as solid.
  if (style.blockOpacity >= 0.7 && contrastRatio(style.colors.text, style.colors.block) < READABLE_CONTRAST) {
    problems.push('blocks');
  }
  return problems;
}

/** Shortcode → emote, for the fields that take one (`:cat:` or `cat`). */
export function findEmote(emotes: Emote[], input: string): Emote | undefined {
  const shortcode = input.trim().replace(/^:|:$/g, '');
  return shortcode ? emotes.find((emote) => emote.shortcode === shortcode) : undefined;
}
