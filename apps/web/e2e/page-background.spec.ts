import { expect, test, type Page } from '@playwright/test';
import { logIn, role, openOwnProfile } from './app';
import { HOMESERVER, api, createUser, eventually, uniqueName, type TestUser } from './matrix';

/**
 * A profile page's background picture keeps its size while the page scrolls and grows (more posts
 * loading): it's drawn on a layer one screen tall, not as the page's background, which `cover`
 * used to stretch over the whole page and so zoom into as it grew (features/profilePage/pageStyle.ts).
 */

const enc = encodeURIComponent;

async function uploadPicture(page: Page, user: TestUser): Promise<string> {
  const png = Buffer.from(
    (
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 300;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#204080';
        g.fillRect(0, 0, 400, 300);
        g.fillStyle = '#f0c040';
        g.fillRect(150, 100, 100, 100);
        return canvas.toDataURL('image/png');
      })
    ).split(',')[1],
    'base64'
  );
  const res = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=wall.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'image/png' },
    body: png,
  });
  return ((await res.json()) as { content_uri: string }).content_uri;
}

for (const fit of ['fixed', 'cover'] as const) {
  test(`a "${fit}" background picture doesn't zoom as the profile scrolls and grows`, async ({ page }) => {
    test.setTimeout(120_000);
    const alice = await createUser('alice');
    await logIn(page, alice);

    // A profile room with plenty of posts, made by posting once through the app.
    await role(page, 'server-rail-global-feed').click();
    await role(page, 'feed-composer-input').fill(uniqueName('first'));
    await role(page, 'feed-composer-submit').click();
    await expect(role(page, 'global-feed-post').first()).toBeVisible();
    // Saved just after the post goes out: waited for, not assumed.
    const { roomId } = await eventually(
      () => api<{ roomId?: string }>(alice, 'GET', `/user/${enc(alice.userId)}/account_data/xyz.nekous.profile_room`).catch(() => ({ roomId: undefined })),
      (data) => !!data.roomId
    ) as { roomId: string };
    for (let i = 0; i < 40; i++) {
      await api(alice, 'PUT', `/rooms/${enc(roomId)}/send/xyz.nekous.post/${uniqueName('txn')}`, {
        body: `post number ${i} ${'with some words to make it a little longer '.repeat(3)}`,
      });
    }
    const url = await uploadPicture(page, alice);
    await api(alice, 'PUT', `/rooms/${enc(roomId)}/state/xyz.nekous.profile_page/`, {
      version: 1,
      style: { background: { kind: 'image', url, fit } },
      blocks: [{ id: 'hi', type: 'text', body: 'Welcome to my page' }],
    });

    await openOwnProfile(page);
    const backdrop = role(page, 'profile-page-backdrop');
    await expect(backdrop).toBeVisible();
    // The posts have loaded: the profile is several screens long.
    // The area that scrolls the profile: the wallpaper's nearest scrolling ancestor.
    const scroller = await backdrop.evaluateHandle((el) => {
      let node = el.parentElement;
      while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
      return node ?? document.scrollingElement!;
    });
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight), { timeout: 30_000 }).toBeGreaterThan(3000);

    const measure = () =>
      backdrop.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), image: getComputedStyle(el).backgroundImage };
      });
    const pageBackground = () => role(page, 'profile-page').evaluate((el) => getComputedStyle(el).backgroundImage);
    const before = await measure();
    expect(before.image).toContain('url(');
    // The page itself no longer carries the picture, so nothing stretches it over the whole page.
    expect(await pageBackground()).toBe('none');

    // Scroll down a long way (loading more posts as it goes), then check again.
    for (let i = 0; i < 6; i++) {
      await scroller.evaluate((el) => el.scrollBy(0, 900));
      await page.waitForTimeout(250);
    }
    const after = await measure();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    if (fit === 'fixed') {
      // Stays put: still at the top of the visible area.
      expect(Math.abs(after.top - before.top)).toBeLessThan(4);
    } else {
      // Fills the first screen and scrolls away with the page.
      expect(after.top).toBeLessThan(before.top - 1000);
    }
  });
}
