import { expect, test, type Page } from '@playwright/test';
import { logIn, role, openOwnProfile } from './app';
import { api, createUser, eventually, uniqueName, type TestUser } from './matrix';

/**
 * A profile page's effect (features/profilePage/PageEffects.tsx) shows for its owner as for
 * anyone, and still shows, standing still, on a device that asks for reduced motion: it used to
 * be hidden there, so an owner with animations off never saw their own page's effect.
 */

const enc = encodeURIComponent;

async function pageWithEffect(page: Page, user: TestUser): Promise<void> {
  await logIn(page, user);
  await role(page, 'server-rail-global-feed').click();
  await role(page, 'feed-composer-input').fill(uniqueName('first'));
  await role(page, 'feed-composer-submit').click();
  await expect(role(page, 'global-feed-post').first()).toBeVisible();
  const { roomId } = (await eventually(
    () => api<{ roomId?: string }>(user, 'GET', `/user/${enc(user.userId)}/account_data/xyz.nekous.profile_room`).catch(() => ({ roomId: undefined })),
    (data) => !!data.roomId
  )) as { roomId: string };
  await api(user, 'PUT', `/rooms/${enc(roomId)}/state/xyz.nekous.profile_page/`, {
    version: 1,
    style: { effect: 'snow' },
    blocks: [{ id: 'hi', type: 'text', body: 'Welcome to my page' }],
  });
}

const particleTops = (page: Page) =>
  role(page, 'profile-page-effects').evaluate((layer) =>
    // Relative to the effect's own view, so the page loading and shifting under it doesn't count as movement.
    Array.from(layer.querySelectorAll('.nu-profile-page__particle'))
      .slice(0, 4)
      .map((p) => Math.round(p.getBoundingClientRect().top - layer.firstElementChild!.getBoundingClientRect().top))
  );

test('the owner sees their page’s effect, falling', async ({ page }) => {
  // Full effects: a headless browser draws in software, where Auto would pick Safe (app/effects.ts).
  await page.addInitScript(() => localStorage.setItem('nekous_effects', 'full'));
  const alice = await createUser('alice');
  await pageWithEffect(page, alice);
  await openOwnProfile(page);
  await expect(role(page, 'profile-page-effects')).toBeVisible();
  const before = await particleTops(page);
  await page.waitForTimeout(1000);
  expect(await particleTops(page)).not.toEqual(before);
});

test('with reduced motion the effect stays, standing still', async ({ browser }) => {
  const alice = await createUser('alice');
  const page = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await pageWithEffect(page, alice);
  await openOwnProfile(page);
  await expect(role(page, 'profile-page-effects')).toBeVisible();
  await expect(role(page, 'profile-page-effects-toggle')).toBeVisible();
  const before = await particleTops(page);
  expect(new Set(before).size).toBeGreaterThan(1); // scattered, not in a row at the top
  await page.waitForTimeout(1000);
  expect(await particleTops(page)).toEqual(before);
});

test('with Safe effects the effect stays, standing still, and the wallpaper isn’t drawn', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nekous_effects', 'safe'));
  const alice = await createUser('alice');
  await pageWithEffect(page, alice);
  await expect(page.locator('html')).toHaveAttribute('data-nu-effects', 'safe');
  await expect(role(page, 'wallpaper')).toHaveCount(0);
  await openOwnProfile(page);
  await expect(role(page, 'profile-page-effects')).toBeVisible();
  const before = await particleTops(page);
  expect(new Set(before).size).toBeGreaterThan(1);
  await page.waitForTimeout(1000);
  expect(await particleTops(page)).toEqual(before);
});
