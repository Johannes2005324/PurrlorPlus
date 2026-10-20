import { expect, test, type Page } from '@playwright/test';
import { logIn, message, openChannel, role, send, openSpace } from './app';
import { api, createSpaceWithChannel, createUser, eventually, sendText, type TestUser } from './matrix';

const enc = encodeURIComponent;

type PowerLevels = { users?: Record<string, number>; events_default?: number; [key: string]: unknown };

async function openPermissions(page: Page, channelName: string) {
  const row = page.locator('.nu-channel-list__row').filter({ has: role(page, 'channel-list-item').filter({ hasText: channelName }) });
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(row, 'channel-list-permissions').click();
  await expect(role(page, 'channel-permissions')).toBeVisible();
}

async function makeModerator(owner: TestUser, spaceId: string, user: TestUser) {
  const levels = await api<PowerLevels>(owner, 'GET', `/rooms/${enc(spaceId)}/state/m.room.power_levels/`);
  await api(owner, 'PUT', `/rooms/${enc(spaceId)}/state/m.room.power_levels/`, { ...levels, users: { ...levels.users, [user.userId]: 50 } });
}

test('a Space moderator becomes a moderator in its channels', async ({ page }) => {
  const [alice, carol] = await Promise.all([createUser('alice'), createUser('carol')]);
  const { spaceId, channelId, spaceName } = await createSpaceWithChannel(alice, [carol]);

  // Alice's client is the one that can change the channel, so it does the copying.
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  await makeModerator(alice, spaceId, carol);

  await eventually(
    () => api<PowerLevels>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.power_levels/`),
    (levels) => levels.users?.[carol.userId] === 50
  );
});

test('an announcement channel: only moderators post, everyone reacts', async ({ browser }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  const announcement = await sendText(alice, channelId, 'big news');

  const alicePage = await (await browser.newContext()).newPage();
  await logIn(alicePage, alice);
  await openChannel(alicePage, spaceName, 'general');
  await openPermissions(alicePage, 'general');
  await role(alicePage, 'channel-permissions-posting').selectOption('moderators');
  await role(alicePage, 'channel-permissions-save').click();
  await expect(role(alicePage, 'channel-permissions')).toBeHidden();
  await eventually(
    () => api<PowerLevels>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.power_levels/`),
    (levels) => levels.events_default === 50
  );

  const bobPage = await (await browser.newContext()).newPage();
  await logIn(bobPage, bob);
  await openSpace(bobPage, spaceName);
  await role(bobPage, 'channel-list-item').filter({ hasText: 'general' }).getByText('general', { exact: true }).click();
  await expect(role(bobPage, 'composer-locked')).toContainText('Only moderators can post');

  // The server enforces it, not just the app: a message is refused, a reaction isn't.
  await expect(sendText(bob, channelId, 'sneaky')).rejects.toThrow(/403/);
  await api(bob, 'PUT', `/rooms/${enc(channelId)}/send/m.reaction/r${Date.now()}`, {
    'm.relates_to': { rel_type: 'm.annotation', event_id: announcement, key: '🎉' },
  });

  await send(alicePage, 'moderators can still post');
});

test('a moderators-only channel: members removed and it disappears for them', async ({ page }) => {
  const [alice, bob, carol] = await Promise.all([createUser('alice'), createUser('bob'), createUser('carol')]);
  const { spaceId, channelId, spaceName } = await createSpaceWithChannel(alice, [bob, carol]);
  await makeModerator(alice, spaceId, carol);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  await openPermissions(page, 'general');
  await role(page, 'channel-permissions-visibility').selectOption('moderators');
  await role(page, 'channel-permissions-save').click();

  const membership = (user: TestUser) =>
    api<{ membership: string }>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.member/${enc(user.userId)}`).then((m) => m.membership);
  await eventually(() => membership(bob), (m) => m === 'leave');
  expect(await membership(carol)).toBe('join');

  const hierarchy = await api<{ rooms: { room_id: string }[] }>(bob, 'GET', `/_matrix/client/v1/rooms/${enc(spaceId)}/hierarchy`);
  expect(hierarchy.rooms.map((r) => r.room_id)).not.toContain(channelId);
  await expect(api(bob, 'POST', `/join/${enc(channelId)}`, {})).rejects.toThrow(/403/);
});

test('a new moderator is brought into a moderators-only channel', async ({ browser }) => {
  const [alice, dave] = await Promise.all([createUser('alice'), createUser('dave')]);
  const { spaceId, channelId, spaceName } = await createSpaceWithChannel(alice);
  await api(dave, 'POST', `/join/${enc(spaceId)}`, {});
  await api(alice, 'PUT', `/rooms/${enc(channelId)}/state/xyz.nekous.channel_settings/`, { moderators_only: true });
  await api(alice, 'PUT', `/rooms/${enc(channelId)}/state/m.room.join_rules/`, { join_rule: 'invite' });

  // Alice's client invites; Dave's accepts because the invite comes from a Space moderator.
  const alicePage = await (await browser.newContext()).newPage();
  const davePage = await (await browser.newContext()).newPage();
  await Promise.all([logIn(alicePage, alice), logIn(davePage, dave)]);
  await makeModerator(alice, spaceId, dave);

  await eventually(
    () =>
      api<{ membership: string }>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.member/${enc(dave.userId)}`).catch(() => ({
        membership: 'none yet',
      })),
    (m) => m.membership === 'join',
    30_000
  );
  await openSpace(davePage, spaceName);
  await expect(role(davePage, 'channel-list-item').filter({ hasText: 'general' })).toBeVisible();
});

test('slowmode holds a member’s next message until it passes', async ({ browser }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  await api(alice, 'PUT', `/rooms/${enc(channelId)}/state/xyz.nekous.channel_settings/`, { slowmode_seconds: 60 });

  const bobPage = await (await browser.newContext()).newPage();
  await logIn(bobPage, bob);
  await openChannel(bobPage, spaceName, 'general');
  await send(bobPage, 'first');
  await expect(role(bobPage, 'composer-slowmode')).toContainText('you can send again in');

  const input = role(bobPage, 'composer-input');
  await input.fill('second, too soon');
  await input.press('Enter');
  await expect(input).toHaveValue('second, too soon');
  await expect(message(bobPage, 'second, too soon')).toHaveCount(0);

  // Moderators aren't slowed down.
  const alicePage = await (await browser.newContext()).newPage();
  await logIn(alicePage, alice);
  await openChannel(alicePage, spaceName, 'general');
  await send(alicePage, 'one');
  await send(alicePage, 'two');
  await expect(role(alicePage, 'composer-slowmode')).toHaveCount(0);
});

test('a custom role and what it can do reach the channels, and a channel gets a moderator of its own', async ({ page }) => {
  const [alice, bob, carol] = await Promise.all([createUser('alice'), createUser('bob'), createUser('carol')]);
  const { spaceId, channelId, spaceName } = await createSpaceWithChannel(alice, [bob, carol]);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  // Space Settings → Roles: a Helper at 25 who can delete messages.
  await page.locator('[aria-label="Space settings"]').first().click();
  await role(page, 'space-settings-roles-tab').click();
  await role(page, 'space-roles-name').fill('Helper');
  await role(page, 'space-roles-level').fill('25');
  await role(page, 'space-roles-create').click();
  await expect(role(page, 'space-roles-row').filter({ hasText: 'Helper' })).toBeVisible();
  await role(page, 'space-roles-capability-redact').selectOption('25');

  // Members: Bob becomes a Helper.
  await page.locator('.nu-modal-tab', { hasText: 'Members' }).click();
  await role(page, 'space-members-row').filter({ hasText: bob.localpart }).locator('[data-nu-role="space-members-set-role"]', { hasText: 'Helper' }).click();
  await eventually(
    () => api<PowerLevels>(alice, 'GET', `/rooms/${enc(spaceId)}/state/m.room.power_levels/`),
    (levels) => levels.users?.[bob.userId] === 25 && levels.redact === 25
  );
  await page.keyboard.press('Escape');

  // The sync carries both into the channel.
  await eventually(
    () => api<PowerLevels>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.power_levels/`),
    (levels) => levels.users?.[bob.userId] === 25 && levels.redact === 25
  );

  // Carol moderates #general only.
  await openPermissions(page, 'general');
  await role(page, 'channel-permissions-moderator-add').selectOption(carol.userId);
  await role(page, 'channel-permissions-save').click();
  await expect(role(page, 'channel-permissions')).toBeHidden();
  await eventually(
    () => api<PowerLevels>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.power_levels/`),
    (levels) => levels.users?.[carol.userId] === 50
  );
  const spaceLevels = await api<PowerLevels>(alice, 'GET', `/rooms/${enc(spaceId)}/state/m.room.power_levels/`);
  expect(spaceLevels.users?.[carol.userId]).toBeUndefined();
});

test('an admin renames a channel and sets its topic from its settings', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await createSpaceWithChannel(alice);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  const row = page.locator('.nu-channel-list__row').filter({ has: role(page, 'channel-list-item').filter({ hasText: 'general' }) });
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(row, 'channel-list-settings').click();
  await role(page, 'channel-settings-name').fill('announcements');
  await role(page, 'channel-settings-topic').fill('Read this first');
  await role(page, 'channel-settings-save').click();
  await expect(role(page, 'channel-settings')).toBeHidden();

  await eventually(
    () => api<{ name?: string }>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.name/`),
    (state) => state.name === 'announcements'
  );
  await eventually(
    () => api<{ topic?: string }>(alice, 'GET', `/rooms/${enc(channelId)}/state/m.room.topic/`),
    (state) => state.topic === 'Read this first'
  );
  await expect(role(page, 'channel-list-item').filter({ hasText: 'announcements' })).toBeVisible();
});
