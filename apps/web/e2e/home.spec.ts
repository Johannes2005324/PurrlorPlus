import { expect, test } from '@playwright/test';
import { createSpaceWithChannel, createUser } from './matrix';
import { logIn, role } from './app';

test('the rail has Home, Feed and Messages, each keeping its own place', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);

  // Opens on Home.
  await expect(role(page, 'server-rail-home')).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'home')).toBeVisible();

  // Messages is the Direct Messages list.
  await role(page, 'server-rail-messages').click();
  await expect(role(page, 'server-rail-messages')).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'server-rail-home')).not.toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'channel-list-start-dm')).toBeVisible();

  // A Space is Messages too.
  const tile = page.locator(`[data-nu-role="server-rail-item"][aria-label="${spaceName}"]`);
  await tile.click();
  await expect(tile).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'server-rail-messages')).toHaveAttribute('aria-current', 'page');

  // Feed takes the highlight, and Messages comes back to the same Space.
  await role(page, 'server-rail-global-feed').click();
  await expect(role(page, 'server-rail-global-feed')).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'server-rail-messages')).not.toHaveAttribute('aria-current', 'page');
  await role(page, 'server-rail-messages').click();
  await expect(tile).toHaveAttribute('aria-current', 'page');

  await role(page, 'server-rail-home').click();
  await expect(role(page, 'home')).toBeVisible();
  await expect(role(page, 'server-rail-messages')).not.toHaveAttribute('aria-current', 'page');
});
