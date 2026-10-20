import { expect, test } from '@playwright/test';
import { logIn, message, openChannel, role, send } from './app';
import { api, createSpaceWithChannel, createUser, uniqueName } from './matrix';

/**
 * A link in a message or a post gets a preview card (title, description, picture), which the
 * homeserver makes by fetching the page (deploy/docker-compose.yml turns Continuwuity's previews
 * on). The linked page here is one the token server serves, its link card for a profile, so the
 * test needs nothing from the internet. Not in an encrypted conversation: previewing would tell the
 * homeserver what was said there.
 */

const LINK = 'http://token-server:3001/api/public/card/nobody-here';

test('a link in a channel message gets a preview card', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  await send(page, `have a look ${LINK}`);
  const card = role(message(page, 'have a look'), 'link-preview-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Purrlor on localhost');
  await expect(card).toContainText('Sign in to see this page.');
});

test('a link in an encrypted conversation gets no preview, so the server never learns it', async ({ page }) => {
  const alice = await createUser('alice');
  const name = uniqueName('secret');
  await api(alice, 'POST', '/createRoom', {
    name,
    preset: 'private_chat',
    initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });
  await logIn(page, alice);
  await role(page, 'server-rail-messages').click();
  await role(page, 'channel-list-item').filter({ hasText: name }).getByText(name, { exact: true }).click();
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('preview_url')) asked.push(request.url());
  });
  await send(page, `private ${LINK}`);
  await page.waitForTimeout(3000);
  await expect(role(message(page, 'private'), 'link-preview-card')).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('a link in a post gets a preview card', async ({ page }) => {
  const alice = await createUser('alice');
  await logIn(page, alice);
  await role(page, 'server-rail-global-feed').click();
  const text = uniqueName('worth reading');
  await role(page, 'feed-composer-input').fill(`${text} ${LINK}`);
  await role(page, 'feed-composer-submit').click();
  const post = role(page, 'global-feed-post').filter({ hasText: text });
  await expect(role(post, 'link-preview-card')).toContainText('Purrlor on localhost', { timeout: 30_000 });
});
