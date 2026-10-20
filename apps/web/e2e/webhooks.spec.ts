import { expect, test } from '@playwright/test';
import { logIn, message, openChannel, openChat, role } from './app';
import { api, createSpaceWithChannel, createUser, eventually, latestEvents, type TestUser } from './matrix';

const enc = encodeURIComponent;
const TOKEN_SERVER = process.env.E2E_TOKEN_SERVER ?? 'http://127.0.0.1:6168';

/** A Space whose voice server is the e2e token server, with its bot in the Space. */
async function spaceWithService(owner: TestUser, members: TestUser[]) {
  const created = await createSpaceWithChannel(owner, members);
  // Asking for the bot's ID also logs the bot in, so it's there to accept the invite.
  const { botUserId } = (await (await fetch(`${TOKEN_SERVER}/api/livekit/config`)).json()) as { botUserId: string };
  await api(owner, 'PUT', `/rooms/${enc(created.spaceId)}/state/xyz.nekous.voice_server/`, {
    url: 'wss://livekit.invalid',
    tokenEndpoint: `${TOKEN_SERVER}/api/livekit/token`,
    botUserId,
  });
  await api(owner, 'POST', `/rooms/${enc(created.spaceId)}/invite`, { user_id: botUserId });
  await eventually(
    () => api<{ membership: string }>(owner, 'GET', `/rooms/${enc(created.spaceId)}/state/m.room.member/${enc(botUserId)}`),
    (m) => m.membership === 'join'
  );
  return { ...created, botUserId };
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a webhook posts into a channel under its own name, until it’s deleted', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceName } = await spaceWithService(alice, [bob]);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  const row = page.locator('.nu-channel-list__row').filter({ has: role(page, 'channel-list-item').filter({ hasText: 'general' }) });
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(row, 'channel-list-webhooks').click();
  await role(page, 'webhook-name').fill('CI');
  await role(page, 'webhook-create').click();
  const url = await role(page, 'webhook-url').inputValue();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:6168\/api\/webhooks\//);

  // Discord's shape; the bot may still be joining the channel on the first try.
  const sent = await eventually(
    () => post(url, { content: 'Build 42 passed', username: 'GitHub' }).then((r) => r.status),
    (status) => status === 204
  );
  expect(sent).toBe(204);
  const posted = message(page, 'Build 42 passed');
  await expect(posted).toBeVisible();
  await expect(role(posted, 'timeline-message-sender')).toHaveText('GitHub');
  await expect(role(posted, 'timeline-webhook-badge')).toBeVisible();

  // Slack's shape, under the webhook's own name.
  expect((await post(url, { text: 'Deployed' })).status).toBe(204);
  await expect(role(message(page, 'Deployed'), 'timeline-message-sender')).toHaveText('CI');

  // A wrong token looks exactly like no webhook at all.
  expect((await post(url.replace(/\/[^/]+$/, '/wrong-token'), { content: 'nope' })).status).toBe(404);
  expect((await post(url, { content: '' })).status).toBe(400);

  // Deleting it kills the URL at once.
  await role(page, 'webhook-delete').click();
  await eventually(
    () => post(url, { content: 'after delete' }).then((r) => r.status),
    (status) => status === 404
  );
});

// A webhook posts an m.notice, which the server's unread counts never include: the Space still
// has to show something new (from read receipts), or a channel fed only by webhooks never does.
test('a webhook’s post marks its Space unread for someone elsewhere', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceName } = await spaceWithService(alice, [bob]);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  const row = page.locator('.nu-channel-list__row').filter({ has: role(page, 'channel-list-item').filter({ hasText: 'general' }) });
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(row, 'channel-list-webhooks').click();
  await role(page, 'webhook-name').fill('CI');
  await role(page, 'webhook-create').click();
  const url = await role(page, 'webhook-url').inputValue();
  await page.keyboard.press('Escape');

  // Somewhere else, so the post arrives unread.
  await openChat(page);
  const tile = page.locator(`[data-nu-role="chat-space"][aria-label="${spaceName}"]`);
  await expect(tile).not.toHaveClass(/nu-chat-spaces__row--unread/);

  await eventually(
    () => post(url, { content: 'Build 43 passed' }).then((r) => r.status),
    (status) => status === 204
  );
  await expect(tile).toHaveClass(/nu-chat-spaces__row--unread/);
});

test('a person can’t pass themselves off as a webhook', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await spaceWithService(alice, [bob]);
  await api(bob, 'PUT', `/rooms/${enc(channelId)}/send/m.room.message/fake${Date.now()}`, {
    msgtype: 'm.notice',
    body: 'Official announcement',
    'com.beeper.per_message_profile': { id: 'x', displayname: 'GitHub' },
  });

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  const fake = message(page, 'Official announcement');
  await expect(role(fake, 'timeline-message-sender')).not.toHaveText('GitHub');
  await expect(role(fake, 'timeline-webhook-badge')).toHaveCount(0);
});

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a webhook with an avatar posts under it, and the avatar can be changed later', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await spaceWithService(alice, []);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  const row = page.locator('.nu-channel-list__row').filter({ has: role(page, 'channel-list-item').filter({ hasText: 'general' }) });
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(row, 'channel-list-webhooks').click();
  await role(page, 'webhook-name').fill('Deploys');
  await role(page, 'webhook-create').click();
  const url = await role(page, 'webhook-url').inputValue();

  // No avatar yet: add one to the webhook that exists.
  await role(page, 'webhook-avatar').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(role(page, 'webhook-avatar-remove')).toBeVisible();

  const hasAvatar = (evs: Awaited<ReturnType<typeof latestEvents>>) =>
    evs.some((e) => e.content.body === 'with a face' && String(e.content['com.beeper.per_message_profile']?.avatar_url ?? '').startsWith('mxc://'));
  await eventually(
    async () => {
      await post(url, { content: 'with a face' });
      return latestEvents(alice, channelId);
    },
    hasAvatar
  );

  // Taking it off leaves the URL working, now without one.
  await role(page, 'webhook-avatar-remove').click();
  await expect(role(page, 'webhook-avatar-remove')).toHaveCount(0);
  expect((await post(url, { content: 'plain again' })).status).toBe(204);
});
