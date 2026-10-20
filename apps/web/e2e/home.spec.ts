import { expect, test } from '@playwright/test';
import { createSpaceWithChannel, createUser } from './matrix';
import { logIn, role } from './app';

test('the rail has Home, Feed and Chat, each keeping its own place', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);

  // Opens on Home.
  await expect(role(page, 'server-rail-home')).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'home')).toBeVisible();

  // Chat is Direct messages and Spaces.
  await role(page, 'server-rail-chat').click();
  await expect(role(page, 'server-rail-chat')).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'server-rail-home')).not.toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'channel-list-start-dm')).toBeVisible();

  // A Space opens inside Chat, with a way back up to the top level.
  await page.locator(`[data-nu-role="chat-space"][aria-label="${spaceName}"]`).click();
  await expect(role(page, 'chat-back')).toBeVisible();
  await expect(role(page, 'server-rail-chat')).toHaveAttribute('aria-current', 'page');

  // Feed takes the highlight, and Chat comes back to the same Space.
  await role(page, 'server-rail-global-feed').click();
  await expect(role(page, 'server-rail-global-feed')).toHaveAttribute('aria-current', 'page');
  await expect(role(page, 'server-rail-chat')).not.toHaveAttribute('aria-current', 'page');
  await role(page, 'server-rail-chat').click();
  await expect(role(page, 'chat-back')).toBeVisible();

  // Chat while already in Chat goes to its top level; Back returns into the Space.
  await role(page, 'server-rail-chat').click();
  await expect(role(page, 'chat-spaces')).toBeVisible();
  await expect(role(page, 'chat-back')).toHaveCount(0);
  await page.locator(`[data-nu-role="chat-space"][aria-label="${spaceName}"]`).click();
  await role(page, 'chat-back').click();
  await expect(role(page, 'chat-spaces')).toBeVisible();

  await role(page, 'server-rail-home').click();
  await expect(role(page, 'home')).toBeVisible();
  await expect(role(page, 'server-rail-chat')).not.toHaveAttribute('aria-current', 'page');
});
