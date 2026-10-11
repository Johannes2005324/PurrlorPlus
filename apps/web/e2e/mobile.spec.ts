import { expect, test } from '@playwright/test';
import { logIn, role } from './app';
import { createSpaceWithChannel, createUser } from './matrix';

/**
 * The phone layout's bottom tab bar (features/servers/MobileTabBar.tsx), which stands in for the
 * server rail there: You reaches your own profile, which a phone had no way to before, and Spaces
 * lists every Space and opens one.
 */

test.use({ viewport: { width: 390, height: 844 } });

test('on a phone, the tab bar reaches your profile and your Spaces', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await expect(role(page, 'mobile-tabs')).toBeVisible();
  await expect(role(page, 'server-rail')).toBeHidden();

  await role(page, 'mobile-tab-you').click();
  await expect(role(page, 'profile-share')).toBeVisible();
  await expect(role(page, 'mobile-tab-you')).toHaveAttribute('aria-current', 'page');

  await role(page, 'mobile-tab-spaces').click();
  const tile = page.locator(`[data-nu-role="server-rail-item"][aria-label="${spaceName}"]`);
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(role(page, 'server-rail')).toBeHidden();
  await expect(page.locator('.nu-channel-list')).toBeVisible();
  await expect(page.locator('.nu-channel-list').getByText('general', { exact: true })).toBeVisible();

  await role(page, 'mobile-tab-home').click();
  await expect(role(page, 'mobile-tab-home')).toHaveAttribute('aria-current', 'page');
});
