import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, openChat, role, openSpace } from './app';
import { api, createSpaceWithChannel, createUser, eventually, type TestUser } from './matrix';

/**
 * Dragging channels and categories in the channel list (features/channels/useChannelDrag.ts): what
 * the list shows straight away, and what the Space's state says once it's saved.
 */

const enc = encodeURIComponent;
const CATEGORIES = 'xyz.nekous.channel_categories';

async function addChannel(owner: TestUser, spaceId: string, name: string, order: string): Promise<string> {
  const { room_id: roomId } = await api<{ room_id: string }>(owner, 'POST', '/createRoom', {
    name,
    preset: 'public_chat',
    initial_state: [{ type: 'm.space.parent', state_key: spaceId, content: { via: ['localhost'], canonical: true } }],
  });
  await api(owner, 'PUT', `/rooms/${enc(spaceId)}/state/m.space.child/${enc(roomId)}`, { via: ['localhost'], order });
  return roomId;
}

/** The names in the channel list, top to bottom, category headers in capitals. */
async function listed(page: Page): Promise<string[]> {
  return role(page, 'channel-list-body')
    .locator('[data-nu-role="channel-list-category-header"] .nu-channel-list__category-name, [data-nu-role="channel-list-item"] .nu-channel-list__item-name')
    .evaluateAll((els) => els.map((el) => (el.closest('[data-nu-role="channel-list-category-header"]') ? el.textContent!.toUpperCase() : el.textContent!)));
}

/** Drags `from` with the mouse to just above (or below) `to`, the way a person would. */
async function dragTo(page: Page, from: Locator, to: Locator, where: 'above' | 'below') {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 3, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 3, a.y + a.height / 2 + 12, { steps: 3 });
  const y = where === 'above' ? b.y + 3 : b.y + b.height - 3;
  await page.mouse.move(b.x + b.width / 3, y, { steps: 8 });
  await page.mouse.up();
}

const channel = (page: Page, name: string) => role(page, 'channel-list-row').filter({ has: page.getByText(name, { exact: true }) });
const header = (page: Page, name: string) => role(page, 'channel-list-category-header').filter({ hasText: name });

test('the Space’s admin drags channels and categories into place, and it’s saved', async ({ page }) => {
  test.setTimeout(120_000);
  const [owner, member] = await Promise.all([createUser('owner'), createUser('member')]);
  const { spaceId, channelId: general, spaceName } = await createSpaceWithChannel(owner, [member]);
  await api(owner, 'PUT', `/rooms/${enc(spaceId)}/state/m.space.child/${enc(general)}`, { via: ['localhost'], order: '0' });
  const rules = await addChannel(owner, spaceId, 'rules', '1');
  const art = await addChannel(owner, spaceId, 'art', '2');
  const lounge = await addChannel(owner, spaceId, 'lounge', '3');
  for (const roomId of [rules, art, lounge]) await api(member, 'POST', `/join/${enc(roomId)}`, {});
  await api(owner, 'PUT', `/rooms/${enc(spaceId)}/state/${CATEGORIES}/`, {
    categories: [
      { id: 'c-text', name: 'Text', channelIds: [art] },
      { id: 'c-hang', name: 'Hangout', channelIds: [lounge] },
    ],
  });

  await logIn(page, owner);
  await openSpace(page, spaceName);
  await expect.poll(() => listed(page)).toEqual(['general', 'rules', 'TEXT', 'art', 'HANGOUT', 'lounge']);

  // Reorder the uncategorized channels.
  await dragTo(page, channel(page, 'rules'), channel(page, 'general'), 'above');
  await expect.poll(() => listed(page)).toEqual(['rules', 'general', 'TEXT', 'art', 'HANGOUT', 'lounge']);

  // A channel into a category: below a category's last channel.
  await dragTo(page, channel(page, 'general'), channel(page, 'art'), 'below');
  await expect.poll(() => listed(page)).toEqual(['rules', 'TEXT', 'art', 'general', 'HANGOUT', 'lounge']);

  // A category above another.
  await dragTo(page, header(page, 'Hangout'), header(page, 'Text'), 'above');
  await expect.poll(() => listed(page)).toEqual(['rules', 'HANGOUT', 'lounge', 'TEXT', 'art', 'general']);

  // And a channel back out to the top.
  await dragTo(page, channel(page, 'lounge'), channel(page, 'rules'), 'above');
  await expect.poll(() => listed(page)).toEqual(['lounge', 'rules', 'HANGOUT', 'TEXT', 'art', 'general']);

  // What the Space says, for everyone.
  const saved = await eventually(
    () => api<{ categories: { id: string; name: string; channelIds: string[] }[] }>(owner, 'GET', `/rooms/${enc(spaceId)}/state/${CATEGORIES}/`),
    (content) => content.categories?.[0]?.id === 'c-hang' && content.categories[1]?.channelIds.join() === [art, general].join()
  );
  expect(saved.categories).toEqual([
    { id: 'c-hang', name: 'Hangout', channelIds: [] },
    { id: 'c-text', name: 'Text', channelIds: [art, general] },
  ]);
  const order = async (roomId: string) => (await api<{ order?: string }>(owner, 'GET', `/rooms/${enc(spaceId)}/state/m.space.child/${enc(roomId)}`)).order;
  await eventually(
    async () => [await order(lounge), await order(rules)],
    ([a, b]) => !!a && !!b && a < b
  );

  // A click is still a click.
  await role(channel(page, 'art'), 'channel-list-item').click();
  await expect(role(page, 'composer-input')).toBeVisible();

  // Someone who can't change the Space's channels can't drag them.
  const memberPage = await (await page.context().browser()!.newContext()).newPage();
  await logIn(memberPage, member);
  await openSpace(memberPage, spaceName);
  await expect.poll(() => listed(memberPage)).toEqual(['lounge', 'rules', 'HANGOUT', 'TEXT', 'art', 'general']);
  await expect(memberPage.locator('[data-nu-drag-channel]')).toHaveCount(0);
});

test('on a touch screen, a long press drags a channel and a swipe still scrolls', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await createUser('owner');
  const { spaceId, channelId: general, spaceName } = await createSpaceWithChannel(owner);
  await api(owner, 'PUT', `/rooms/${enc(spaceId)}/state/m.space.child/${enc(general)}`, { via: ['localhost'], order: '0' });
  await addChannel(owner, spaceId, 'rules', '1');
  await addChannel(owner, spaceId, 'art', '2');

  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await logIn(page, owner);
  await openSpace(page, spaceName);
  await expect.poll(() => listed(page)).toEqual(['general', 'rules', 'art']);

  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const centre = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 3, y: box.y + box.height / 2 };
  };

  // A quick swipe moves nothing.
  const swipe = await centre(channel(page, 'art'));
  await touch('touchStart', swipe.x, swipe.y);
  await touch('touchMove', swipe.x, swipe.y - 30);
  await touch('touchEnd');
  await page.waitForTimeout(500);
  expect(await listed(page)).toEqual(['general', 'rules', 'art']);

  // Hold, then move: art goes to the top.
  const from = await centre(channel(page, 'art'));
  const to = (await channel(page, 'general').boundingBox())!;
  await touch('touchStart', from.x, from.y);
  await page.waitForTimeout(500);
  for (let i = 1; i <= 8; i++) await touch('touchMove', from.x, from.y + ((to.y + 3 - from.y) * i) / 8);
  await touch('touchEnd');
  await expect.poll(() => listed(page)).toEqual(['art', 'general', 'rules']);
  await context.close();
});

test('Spaces are dragged into your own order in the rail, which is saved for your other devices', async ({ page }) => {
  test.setTimeout(120_000);
  const me = await createUser('me');
  const made: string[] = [];
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    const { room_id: roomId } = await api<{ room_id: string }>(me, 'POST', '/createRoom', {
      name: `${name} ${Date.now()}`,
      preset: 'private_chat',
      creation_content: { type: 'm.space' },
    });
    made.push(roomId);
  }
  await logIn(page, me);
  await openChat(page);
  const tiles = () =>
    page.locator('[data-nu-role="chat-space-list"] [data-nu-role="chat-space"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!.split(' ')[0]));
  await expect.poll(tiles).toEqual(['Alpha', 'Beta', 'Gamma']);

  const tile = (name: string) => page.locator(`[data-nu-role="chat-space"][aria-label^="${name} "]`);
  await dragTo(page, tile('Gamma'), tile('Alpha'), 'above');
  await expect.poll(tiles).toEqual(['Gamma', 'Alpha', 'Beta']);
  await dragTo(page, tile('Alpha'), tile('Beta'), 'below');
  await expect.poll(tiles).toEqual(['Gamma', 'Beta', 'Alpha']);

  // Saved where Element keeps it, so it's the same everywhere.
  const order = async (roomId: string) =>
    (await api<{ order?: string }>(me, 'GET', `/user/${enc(me.userId)}/rooms/${enc(roomId)}/account_data/org.matrix.msc3230.space_order`)).order ?? '';
  await eventually(
    async () => Promise.all(made.map(order)),
    ([alpha, beta, gamma]) => !!alpha && !!beta && !!gamma && gamma < beta && beta < alpha
  );
  await page.reload();
  await openChat(page);
  await expect.poll(tiles).toEqual(['Gamma', 'Beta', 'Alpha']);

  // A click still opens the Space.
  await tile('Beta').click();
  await expect(role(page, 'chat-back')).toBeVisible();
  await expect(page.locator('.nu-channel-list').getByText('Beta').first()).toBeVisible();
});
