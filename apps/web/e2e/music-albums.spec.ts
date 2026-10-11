import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, openApp, role } from './app';
import { createUser } from './matrix';

/**
 * A creator sorting their music into albums in the page builder: uploads into an album, a second
 * album with a cover, a track moved between them, then the published page's shelf and player.
 */

/** A second of silence as a WAV file: a real sound the browser can measure and play. */
function silentWav(seconds = 1): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples, 40);
  wav.fill(128, 44);
  return wav;
}

// Long enough to still be playing when the test looks back at the shelf.
const track = (name: string) => ({ name, mimeType: 'audio/wav', buffer: silentWav(30) });

async function addTracks(album: Locator, names: string[]): Promise<void> {
  const before = await role(album, 'page-editor-track').count();
  await role(album, 'page-editor-add-tracks').setInputFiles(names.map(track));
  await expect(role(album, 'page-editor-track')).toHaveCount(before + names.length, { timeout: 30_000 });
}

async function openBuilder(page: Page): Promise<void> {
  await role(page, 'server-rail-global-feed').click();
  await role(page, 'social-nav-profile').click();
  await role(page, 'profile-edit-page').click();
  await expect(role(page, 'page-editor')).toBeVisible();
}

const TOKEN_SERVER = process.env.E2E_TOKEN_SERVER ?? 'http://127.0.0.1:6168';

/** The app's public API is served by the token server; in a deployment nginx routes it there. */
async function routePublicApi(page: Page): Promise<void> {
  await page.route('**/api/public/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${TOKEN_SERVER}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}

const playing = (page: Page) => page.locator('[data-nu-role="music-audio"]').evaluate((el: HTMLAudioElement) => (el.paused ? -1 : el.currentTime));

test('a creator sorts tracks into albums; visitors browse them, play on while moving around, and share links', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const artist = await createUser('artist');
  await logIn(page, artist);
  await openBuilder(page);

  await role(page, 'page-editor-add-block').selectOption('music');
  const albums = role(page, 'page-editor-music-album');
  await expect(albums).toHaveCount(1);

  await role(albums.nth(0), 'page-editor-music-album-title').fill('Night Drive');
  await addTracks(albums.nth(0), ['Headlights.wav', 'Overpass.wav', 'Stray demo.wav']);

  await role(page, 'page-editor-add-music-album').click();
  await expect(albums).toHaveCount(2);
  await role(albums.nth(1), 'page-editor-music-album-title').fill('Demos');
  await albums.nth(1).getByLabel('Year (optional)').fill('2025');
  // Any real PNG will do for a cover: a square of the screen.
  const cover = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
  await albums.nth(1).locator('input[type="file"]:not([accept*="audio"])').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
  await expect(albums.nth(1).locator('.nu-page-editor__thumb img')).toBeVisible({ timeout: 30_000 });

  // The demo belongs in Demos.
  const stray = role(albums.nth(0), 'page-editor-track').nth(2);
  await role(stray, 'page-editor-track-album').selectOption({ label: 'Demos' });
  await expect(role(albums.nth(0), 'page-editor-track')).toHaveCount(2);
  await expect(role(albums.nth(1), 'page-editor-track')).toHaveCount(1);
  await expect(role(albums.nth(1), 'page-editor-track').locator('input').first()).toHaveValue('Stray demo');

  // Shown to everyone, so the links work signed out too.
  await role(page, 'public-page-toggle').click();
  await expect(role(page, 'public-page-toggle')).toBeChecked({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('builder.png'), fullPage: true });
  await role(page, 'page-editor-publish').click();
  await expect(role(page, 'page-editor')).toBeHidden({ timeout: 30_000 });

  // The page: the music module, closed to its title until opened; then a shelf of covers and
  // titles, nothing more, so the posts stay in reach.
  await expect(role(page, 'music-album-card')).toHaveCount(0);
  await role(page, 'profile-page-module-toggle').click();
  const cards = role(page, 'music-album-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Night Drive');
  await expect(cards.nth(1)).toContainText('2025 · 1 track');
  await expect(cards.nth(1).locator('img')).toBeVisible();
  await expect(role(page, 'music-track')).toHaveCount(0);
  await expect(role(page, 'profile-share')).toHaveAttribute('data-nu-link', new RegExp(`/@${artist.localpart}$`));
  await page.screenshot({ path: testInfo.outputPath('shelf.png'), fullPage: true });

  // An album opens over the page and plays in the app's player.
  await cards.nth(0).click();
  await expect(role(page, 'music-track')).toHaveCount(2);
  const albumLink = (await role(page, 'music-album-link').getAttribute('data-nu-link')) ?? '';
  const trackLink = (await role(page, 'music-track-link').nth(1).getAttribute('data-nu-link')) ?? '';
  expect(albumLink).toMatch(new RegExp(`/@${artist.localpart}/music/[A-Za-z0-9_-]+$`));
  expect(trackLink).toBe(`${albumLink}/2`);
  await role(page, 'music-play-album').click();
  await expect.poll(() => playing(page), { timeout: 15_000 }).toBeGreaterThan(0);
  // Every track's link button sits inside the dialog, not cut off past its edge.
  const panel = await page.locator('.nu-modal__panel').boundingBox();
  const lastLink = await role(page, 'music-track-link').nth(1).boundingBox();
  expect(lastLink && panel && lastLink.x + lastLink.width <= panel.x + panel.width).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('album.png'), fullPage: true });
  await role(page, 'modal-close').click();

  // Away from the profile, to the DMs: still playing, with the player in the sidebar.
  await role(page, 'server-rail-home').click();
  await expect(role(page, 'profile-share')).toHaveCount(0);
  const player = role(page, 'music-player').first();
  await expect(player).toBeVisible();
  await expect(role(player, 'music-player-title')).toHaveText('Headlights');
  const before = await playing(page);
  await expect.poll(() => playing(page), { timeout: 15_000 }).toBeGreaterThan(before);
  await expect(player.locator('.nu-music-player__time').first()).not.toHaveText('0:00', { timeout: 10_000 });
  await page.screenshot({ path: testInfo.outputPath('elsewhere.png') });

  // On a phone the sidebar's out of sight on the feed, so the player is a strip across the top.
  await page.setViewportSize({ width: 390, height: 844 });
  // On a phone the rail gives way to the bottom tab bar (MobileTabBar.tsx).
  await role(page, 'mobile-tab-feed').click();
  const strip = page.locator('.nu-music-player--mini');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('Headlights');
  const stripBox = await strip.boundingBox();
  expect(stripBox?.y).toBe(0);
  // The member drawer slides shut when the window shrinks: let it finish before the picture.
  await expect(role(strip, 'music-player-toggle')).toBeInViewport({ ratio: 1 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('phone.png') });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Signed in, an album's link opens the profile with that album open.
  await page.goto(trackLink);
  await expect(role(page, 'music-track')).toHaveCount(2, { timeout: 30_000 });
  await expect(role(page, 'music-track').nth(1)).toHaveClass(/nu-profile-page__track--linked/);

  // Signed out: the same link, once the public web has picked the page up.
  await expect
    .poll(async () => (await fetch(`${TOKEN_SERVER}/api/public/pages/${artist.localpart}`)).status, { timeout: 90_000, intervals: [3000] })
    .toBe(200);
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await routePublicApi(visitorPage);
  await openApp(visitorPage, albumLink);
  await expect(role(visitorPage, 'music-track')).toHaveCount(2, { timeout: 30_000 });
  await role(visitorPage, 'music-play-album').click();
  await expect(role(visitorPage, 'music-player')).toBeVisible();
  await expect.poll(() => playing(visitorPage), { timeout: 15_000 }).toBeGreaterThan(0);
  await visitorPage.screenshot({ path: testInfo.outputPath('signed-out.png') });
  await visitor.close();

  // And the link's preview, for the bots that unfurl it.
  const path = new URL(trackLink).pathname.replace(/^\/@/, '');
  const card = await (await fetch(`${TOKEN_SERVER}/api/public/card/${path}`)).text();
  expect(card).toContain('<meta property="og:title" content="Overpass · ');
  expect(card).toContain('from Night Drive');
});
