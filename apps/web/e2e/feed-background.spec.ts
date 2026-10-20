import { expect, test } from '@playwright/test';
import { logIn, role } from './app';
import { api, createUser } from './matrix';

/**
 * A picture of your own behind the main feed (Settings → Appearance; matrix/feedBackground.ts):
 * uploaded there, kept in your account data, and drawn behind Everyone under a dimming layer.
 */
test('a picture set in Appearance shows behind the main feed, and can be taken away', async ({ page }) => {
  const alice = await createUser('alice');
  await logIn(page, alice);
  const png = Buffer.from(
    (
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 300;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#802040';
        g.fillRect(0, 0, 400, 300);
        return canvas.toDataURL('image/png');
      })
    ).split(',')[1],
    'base64'
  );

  await role(page, 'server-rail-settings').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  const setting = role(page, 'feed-background-setting');
  await setting.locator('input[type="file"]').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: png });
  await expect(role(page, 'feed-background-dim')).toBeVisible({ timeout: 20_000 });
  const saved = await api<{ url?: string; dim?: number }>(alice, 'GET', `/user/${encodeURIComponent(alice.userId)}/account_data/xyz.nekous.feed_background`);
  expect(saved.url).toMatch(/^mxc:\/\//);
  expect(saved.dim).toBe(60);
  await page.keyboard.press('Escape');

  await role(page, 'server-rail-global-feed').click();
  const feed = role(page, 'global-feed');
  await expect.poll(() => feed.evaluate((el) => getComputedStyle(el).backgroundImage), { timeout: 20_000 }).toContain('url(');

  // Taken away again (as from another device): the feed is plain.
  await api(alice, 'PUT', `/user/${encodeURIComponent(alice.userId)}/account_data/xyz.nekous.feed_background`, {});
  await expect.poll(() => feed.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
});
