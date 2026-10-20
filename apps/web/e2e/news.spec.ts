import { expect, test, type Page } from '@playwright/test';
import { logIn, role, openSpace } from './app';
import { api, createSpaceWithChannel, createUser, eventually } from './matrix';

const enc = encodeURIComponent;

/** Leaves the Space and opens it again from the rail, the way someone coming back to it would. */
async function reopenSpace(page: Page, spaceName: string): Promise<void> {
  await role(page, 'server-rail-chat').click();
  await openSpace(page, spaceName);
}

test('a Space’s news shows on the first visit, then the Space opens on its first channel, until the news is announced again', async ({
  browser,
}) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  const news = () => api<{ body?: string; revision?: string }>(alice, 'GET', `/rooms/${enc(spaceId)}/state/xyz.nekous.space_news/`);

  // No news yet: opening the Space goes straight to its first text channel. Alice, the admin,
  // writes the news.
  const alicePage = await (await browser.newContext()).newPage();
  await logIn(alicePage, alice);
  await openSpace(alicePage, spaceName);
  await expect(role(alicePage, 'composer-input')).toBeVisible();
  await role(alicePage, 'channel-list-news').click();
  await role(alicePage, 'news-edit').click();
  await role(alicePage, 'news-input').fill('Welcome! Movie night is on Friday.');
  await role(alicePage, 'news-save').click();
  await expect(role(alicePage, 'news-body')).toHaveText('Welcome! Movie night is on Friday.');
  const first = await eventually(news, (n) => n.body === 'Welcome! Movie night is on Friday.');

  // Bob's first visit: the news, which he can't edit, and on to the channel.
  const bobPage = await (await browser.newContext()).newPage();
  await logIn(bobPage, bob);
  await openSpace(bobPage, spaceName);
  await expect(role(bobPage, 'news-body')).toHaveText('Welcome! Movie night is on Friday.');
  await expect(role(bobPage, 'news-edit')).toHaveCount(0);
  await role(bobPage, 'news-continue').click();
  await expect(role(bobPage, 'composer-input')).toBeVisible();
  // Seen, and kept in his account data so every device of his knows.
  await eventually(
    () => api<Record<string, string>>(bob, 'GET', `/user/${enc(bob.userId)}/account_data/xyz.nekous.news_seen`).catch((): Record<string, string> => ({})),
    (seen) => seen[spaceId] === first.revision
  );

  // Coming back: straight to the channel.
  await reopenSpace(bobPage, spaceName);
  await expect(role(bobPage, 'composer-input')).toBeVisible();
  await expect(role(bobPage, 'news')).toHaveCount(0);

  // A small fix, not announced: still the channel for Bob.
  await role(alicePage, 'news-edit').click();
  await role(alicePage, 'news-input').fill('Welcome! Movie night is on Friday at 7.');
  await role(alicePage, 'news-announce').uncheck();
  await role(alicePage, 'news-save').click();
  await eventually(news, (n) => n.body === 'Welcome! Movie night is on Friday at 7.' && n.revision === first.revision);
  await reopenSpace(bobPage, spaceName);
  await expect(role(bobPage, 'composer-input')).toBeVisible();
  await expect(role(bobPage, 'news')).toHaveCount(0);

  // Announced: Bob sees it on his next visit.
  await role(alicePage, 'news-edit').click();
  await role(alicePage, 'news-input').fill('Movie night moved to Saturday!');
  await role(alicePage, 'news-save').click();
  await eventually(news, (n) => n.body === 'Movie night moved to Saturday!' && n.revision !== first.revision);
  await reopenSpace(bobPage, spaceName);
  await expect(role(bobPage, 'news-body')).toHaveText('Movie night moved to Saturday!');
});

test('who may edit the news is a role setting, and the homeserver holds to it', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceId, spaceName } = await createSpaceWithChannel(alice, [bob]);

  // Bob, a member, can't write it: the Space's power levels say so, not just the UI.
  await expect(api(bob, 'PUT', `/rooms/${enc(spaceId)}/state/xyz.nekous.space_news/`, { body: 'hi', revision: 'x' })).rejects.toThrow();

  // Alice lets everyone edit the news in Space Settings → Roles.
  await logIn(page, alice);
  await openSpace(page, spaceName);
  await page.locator('[aria-label="Space settings"]').first().click();
  await role(page, 'space-settings-roles-tab').click();
  await role(page, 'space-roles-capability-news').selectOption({ label: 'Everyone' });
  await eventually(
    () => api<{ events?: Record<string, number> }>(alice, 'GET', `/rooms/${enc(spaceId)}/state/m.room.power_levels/`),
    (levels) => levels.events?.['xyz.nekous.space_news'] === 0
  );
  await api(bob, 'PUT', `/rooms/${enc(spaceId)}/state/xyz.nekous.space_news/`, { body: 'Bob was here', revision: 'bob-1' });
});

test('each Space opens on its own first channel when switching between them on the rail', async ({ page }) => {
  const alice = await createUser('alice');
  const first = await createSpaceWithChannel(alice, [], 'lobby');
  const second = await createSpaceWithChannel(alice, [], 'hangout');
  const header = role(page, 'main-pane-header').locator('.nu-main-pane__header-name');

  await logIn(page, alice);
  for (const [space, channel] of [
    [first, 'lobby'],
    [second, 'hangout'],
    [first, 'lobby'],
  ] as const) {
    await openSpace(page, space.spaceName);
    await expect(header).toHaveText(channel);
  }
});
