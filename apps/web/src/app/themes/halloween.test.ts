import { describe, expect, it } from 'vitest';
import { sanitizeThemeCss } from '../themeSanitize';
import { HALLOWEEN_CSS } from './halloween';

describe('the Halloween preset', () => {
  it('survives the theme sanitizer whole', () => {
    expect(sanitizeThemeCss(HALLOWEEN_CSS).removed).toEqual([]);
  });

  it('draws only well-formed SVGs (a broken one would just show nothing)', () => {
    const uris = [...HALLOWEEN_CSS.matchAll(/url\("data:image\/svg\+xml,([^"]+)"\)/g)].map((m) => decodeURIComponent(m[1]));
    expect(uris.length).toBe(6);
    for (const source of uris) {
      const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(doc.documentElement.nodeName).toBe('svg');
    }
  });

  it('loads nothing from outside but its font, which the CSP allows', () => {
    const external = [...HALLOWEEN_CSS.matchAll(/url\(['"]?(https?:[^'")]+)/g)].map((m) => new URL(m[1]).host);
    expect(external).toEqual(['fonts.googleapis.com']);
  });
});
