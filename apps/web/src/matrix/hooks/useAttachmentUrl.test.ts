import { describe, expect, it } from 'vitest';
import { attachmentFileName, inlineThumbnailSize } from './useAttachmentUrl';

describe('inlineThumbnailSize', () => {
  it('asks for twice the box for a large photo, as the server thumbnail that covers it', () => {
    expect(inlineThumbnailSize('image/jpeg', 4000, 3000, 120, 100)).toEqual({ width: 320, height: 240, method: 'scale' });
    expect(inlineThumbnailSize('image/jpeg', 4000, 3000, 240, 240)).toEqual({ width: 640, height: 480, method: 'scale' });
  });

  it('asks for the largest server thumbnail at most: past it the server sends the original', () => {
    expect(inlineThumbnailSize('image/jpeg', 4000, 3000, 360, 320)).toEqual({ width: 800, height: 600, method: 'scale' });
    expect(inlineThumbnailSize('image/png', undefined, undefined, 360, 320)).toEqual({ width: 800, height: 600, method: 'scale' });
  });

  it('loads an image no larger than the thumbnail whole', () => {
    expect(inlineThumbnailSize('image/png', 600, 400, 360, 320)).toBeUndefined();
    expect(inlineThumbnailSize('image/png', 800, 600, 360, 320)).toBeUndefined();
  });

  it('keeps types a thumbnail would flatten whole', () => {
    expect(inlineThumbnailSize('image/gif', 4000, 3000, 360, 320)).toBeUndefined();
    expect(inlineThumbnailSize('image/webp', 4000, 3000, 360, 320)).toBeUndefined();
    expect(inlineThumbnailSize('image/svg+xml', 4000, 3000, 360, 320)).toBeUndefined();
    expect(inlineThumbnailSize(undefined, 4000, 3000, 360, 320)).toBeUndefined();
  });
});

describe('attachmentFileName', () => {
  it('keeps a name that has an extension', () => {
    expect(attachmentFileName('clip.mp4', 'video/mp4')).toBe('clip.mp4');
    expect(attachmentFileName('Clip.MOV', 'video/quicktime')).toBe('Clip.MOV');
  });

  it('adds one from the type when the name has none', () => {
    expect(attachmentFileName('clip', 'video/mp4')).toBe('clip.mp4');
    expect(attachmentFileName('clip', 'video/quicktime')).toBe('clip.mov');
    expect(attachmentFileName('song', 'audio/mpeg')).toBe('song.mp3');
    expect(attachmentFileName('  ', 'video/webm')).toBe('file.webm');
  });

  it('leaves the name alone without a usable type', () => {
    expect(attachmentFileName('clip', undefined)).toBe('clip');
    expect(attachmentFileName('clip', 'application/vnd.something-long')).toBe('clip');
  });
});
