import { expect, test, type Page } from '@playwright/test';
import { logIn, role, send, openSpace } from './app';
import { api, createSpaceWithChannel, createUser, eventually, latestEvents, type TestUser } from './matrix';

const enc = encodeURIComponent;

const encryption = (user: TestUser, roomId: string) =>
  api<{ algorithm?: string }>(user, 'GET', `/rooms/${enc(roomId)}/state/m.room.encryption/`).catch(() => ({ algorithm: undefined }));

async function createChannel(page: Page, name: string, options: { isPublic?: boolean } = {}): Promise<boolean> {
  await role(page, 'channel-list-add').click();
  await role(page, 'create-channel-name').fill(name);
  if (options.isPublic) await role(page, 'create-channel-public').check();
  const encrypted = await role(page, 'create-channel-encrypted').isChecked();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(role(page, 'channel-list-item').filter({ hasText: name })).toBeVisible();
  return encrypted;
}

/** The room a channel name is, as the owner sees it on the server. */
async function roomIdOf(owner: TestUser, spaceId: string, name: string): Promise<string> {
  const { rooms } = await eventually(
    () => api<{ rooms: { room_id: string; name?: string }[] }>(owner, 'GET', `/_matrix/client/v1/rooms/${enc(spaceId)}/hierarchy`),
    (h) => h.rooms.some((r) => r.name === name)
  );
  return rooms.find((r) => r.name === name)!.room_id;
}

test('new private channels are encrypted, public ones aren’t, unless chosen', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceId, spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openSpace(page, spaceName);

  expect(await createChannel(page, 'secret-plans')).toBe(true);
  expect((await encryption(alice, await roomIdOf(alice, spaceId, 'secret-plans'))).algorithm).toBe('m.megolm.v1.aes-sha2');

  expect(await createChannel(page, 'lobby', { isPublic: true })).toBe(false);
  expect((await encryption(alice, await roomIdOf(alice, spaceId, 'lobby'))).algorithm).toBeUndefined();
});

test('a new DM is encrypted', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  await logIn(page, alice);
  await role(page, 'server-rail-chat').click();
  await role(page, 'channel-list-start-dm').click();
  await role(page, 'start-dm-user-id').fill(bob.userId);
  await role(page, 'start-dm-user-id').press('Enter');
  await expect(role(page, 'composer-input')).toBeVisible();

  const { rooms } = await eventually(
    () => api<{ rooms: { invite?: Record<string, unknown> } }>(bob, 'GET', '/sync?timeout=0'),
    (s) => Object.keys(s.rooms?.invite ?? {}).length > 0
  );
  const dmId = Object.keys(rooms.invite!)[0];
  expect((await encryption(alice, dmId)).algorithm).toBe('m.megolm.v1.aes-sha2');
});

test('turning on encryption for an existing channel warns first, then encrypts it', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openSpace(page, spaceName);
  await role(page, 'channel-list-item').filter({ hasText: 'general' }).getByText('general', { exact: true }).click();

  const row = page.locator('.nu-channel-list__row').filter({ has: role(page, 'channel-list-item').filter({ hasText: 'general' }) });
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(row, 'channel-list-permissions').click();
  await expect(role(page, 'channel-permissions-encrypt-warning')).toHaveCount(0);
  await expect(role(page, 'main-pane-encrypted')).toHaveCount(0);
  await role(page, 'channel-permissions-encrypt').check();
  await expect(role(page, 'channel-permissions-encrypt-warning')).toContainText('can’t be undone');
  await role(page, 'channel-permissions-save').click();
  // The lock shows up in the channel's header and its row, without a reload.
  await expect(role(page, 'main-pane-encrypted')).toBeVisible();
  await expect(role(row, 'channel-list-item-encrypted')).toBeVisible();

  await eventually(
    () => encryption(alice, channelId),
    (e) => e.algorithm === 'm.megolm.v1.aes-sha2'
  );
  // And what's sent from now on is ciphertext to the server.
  await send(page, 'now private');
  await eventually(
    () => latestEvents(alice, channelId),
    (evs) => evs.some((e) => e.type === 'm.room.encrypted' && e.sender === alice.userId)
  );
});
