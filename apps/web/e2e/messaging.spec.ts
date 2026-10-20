import { expect, test } from '@playwright/test';
import { clickMessageAction, logIn, message, openChannel, role, send } from './app';
import { api, createSpaceWithChannel, createUser, eventually, latestEvents, sendText, uniqueName } from './matrix';

test('sign in, send a message, and see a reply arrive', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  await send(page, 'hello from the browser');
  const events = await eventually(
    () => latestEvents(bob, channelId),
    (evs) => evs.some((e) => e.type === 'm.room.message' && e.content.body === 'hello from the browser')
  );
  expect(events.find((e) => e.content.body === 'hello from the browser')?.sender).toBe(alice.userId);

  await sendText(bob, channelId, 'hi alice, got it');
  await expect(message(page, 'hi alice, got it')).toBeVisible();
});

test('react to a message', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  const eventId = await sendText(bob, channelId, 'react to this');

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  const target = message(page, 'react to this');
  await clickMessageAction(target, 'reaction-picker-toggle');
  await role(target, 'reaction-picker-panel').getByRole('button', { name: '👍' }).click();
  await expect(role(target, 'reaction-pill')).toContainText('1');

  await eventually(
    () => latestEvents(bob, channelId),
    (evs) =>
      evs.some(
        (e) => e.type === 'm.reaction' && e.sender === alice.userId && e.content['m.relates_to']?.event_id === eventId && e.content['m.relates_to']?.key === '👍'
      )
  );
});

test('the composer keeps keyboard focus: on opening a channel, after an emoji, after attaching a file', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await createSpaceWithChannel(alice, []);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  const input = role(page, 'composer-input');
  await expect(input).toBeFocused();

  // Typed straight away, no click into the box first.
  await page.keyboard.type('typed on arrival');
  await page.keyboard.press('Enter');
  await expect(message(page, 'typed on arrival')).toBeVisible();

  await page.keyboard.type('with emoji ');
  await role(page, 'emoji-emote-picker-toggle').click();
  await role(page, 'emoji-picker-item').first().click();
  await expect(input).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(message(page, 'with emoji')).toBeVisible();

  await role(page, 'composer-file-input').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(role(page, 'composer-attachment')).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press('Enter');
  await eventually(
    () => latestEvents(alice, channelId),
    (evs) => evs.some((e) => e.type === 'm.room.message' && e.content.body === 'note.txt')
  );
});

test('a mention in a channel shows in Notifications and opens at the message', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);

  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  // Somewhere else, so the mention arrives while alice isn't looking at it.
  await role(page, 'server-rail-global-feed').click();
  await expect(role(page, 'social-nav')).toBeVisible();

  await api(bob, 'PUT', `/rooms/${encodeURIComponent(channelId)}/send/m.room.message/${uniqueName('txn')}`, {
    msgtype: 'm.text',
    body: 'alice: can you look at this?',
    'm.mentions': { user_ids: [alice.userId] },
  });

  const bell = role(page, 'server-rail-notifications');
  await expect(role(bell, 'unread-badge-highlight')).toHaveText('1');
  await bell.click();
  const row = role(page, 'activity-row').filter({ hasText: 'mentioned you in #general' });
  await expect(row).toContainText('alice: can you look at this?');
  // Looking at it counts as seen.
  await expect(role(bell, 'unread-badge-highlight')).toHaveCount(0);

  await row.click();
  await expect(message(page, 'alice: can you look at this?')).toHaveClass(/nu-timeline__message--highlighted/);
});

test('a mention that arrives while Notifications sits hidden behind another page still counts', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId } = await createSpaceWithChannel(alice, [bob]);

  // Notifications open, then somewhere else: the feed stays loaded behind it (MainPane), but the
  // Notifications list mustn't count what arrives meanwhile as seen.
  await logIn(page, alice);
  const bell = role(page, 'server-rail-notifications');
  await bell.click();
  await expect(role(page, 'social-nav')).toBeVisible();
  await role(page, 'server-rail-messages').click();
  await expect(role(page, 'social-nav')).toHaveCount(0);

  await api(bob, 'PUT', `/rooms/${encodeURIComponent(channelId)}/send/m.room.message/${uniqueName('txn')}`, {
    msgtype: 'm.text',
    body: 'alice: while you were away',
    'm.mentions': { user_ids: [alice.userId] },
  });
  await expect(role(bell, 'unread-badge-highlight')).toHaveText('1');
  await page.waitForTimeout(1500);
  await expect(role(bell, 'unread-badge-highlight')).toHaveText('1');
});

test('the message box and the post box grow as you type, up to a limit, and shrink once sent', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceName } = await createSpaceWithChannel(alice, [bob]);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  const height = async (name: string) => (await role(page, name).boundingBox())!.height;
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

  // A channel's message box: one line to start, taller for four, capped (then it scrolls).
  const input = role(page, 'composer-input');
  const empty = await height('composer-input');
  await input.fill(lines(4));
  const four = await height('composer-input');
  expect(four).toBeGreaterThan(empty * 2.5);
  await input.fill(lines(60));
  const capped = await height('composer-input');
  expect(capped).toBeLessThanOrEqual(320.5);
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Sent, it's one line again.
  await input.fill(lines(4));
  await input.press('Enter');
  await expect(message(page, 'line 4')).toBeVisible();
  await expect.poll(() => height('composer-input')).toBeLessThan(empty + 1);

  // The feed's post box: grows the same way.
  await role(page, 'server-rail-global-feed').click();
  const post = role(page, 'feed-composer-input');
  const postEmpty = await height('feed-composer-input');
  await post.fill(lines(12));
  expect(await height('feed-composer-input')).toBeGreaterThan(postEmpty * 2);
  expect(await post.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
});
