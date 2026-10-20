import { expect, test } from '@playwright/test';
import { logIn, openChannel, role, openSpace } from './app';
import { api, createSpaceWithChannel, createUser, eventually, latestEvents, uniqueName } from './matrix';

test('publish a post to a Space', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceId, spaceName } = await createSpaceWithChannel(alice);

  await logIn(page, alice);
  await openSpace(page, spaceName);
  await role(page, 'channel-list-feed').click();

  // The first post also creates your feed room in this Space (matrix/feed.ts).
  await role(page, 'feed-composer-input').fill('my first post');
  await role(page, 'feed-composer-submit').click();
  await expect(role(page, 'feed-post').filter({ hasText: 'my first post' })).toBeVisible();

  const feeds = await eventually(
    () =>
      api<Record<string, string>>(alice, 'GET', `/user/${encodeURIComponent(alice.userId)}/account_data/xyz.nekous.feed_rooms`).catch(
        (): Record<string, string> => ({})
      ),
    (value) => !!value[spaceId]
  );
  const events = await eventually(
    () => latestEvents(alice, feeds[spaceId]),
    (evs) => evs.some((e) => e.type === 'xyz.nekous.post')
  );
  expect(JSON.stringify(events.find((e) => e.type === 'xyz.nekous.post')?.content)).toContain('my first post');
});

test('going to a chat and back to the global feed doesn’t load it all again', async ({ page }) => {
  const alice = await createUser('alice');
  const { spaceName } = await createSpaceWithChannel(alice);

  // A public post, from the global feed's own composer (Global: your profile). Everyone on the test
  // server sees it, so its words are this run's own.
  const text = uniqueName('still here when you come back');
  await logIn(page, alice);
  await role(page, 'server-rail-global-feed').click();
  await role(page, 'feed-composer-input').fill(text);
  await role(page, 'feed-composer-submit').click();
  await expect(role(page, 'global-feed-post').filter({ hasText: text })).toBeVisible();

  // A load starts by asking the room directory for public Spaces and profiles.
  let directoryRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/publicRooms')) directoryRequests += 1;
  });
  await openChannel(page, spaceName, 'general');
  await role(page, 'server-rail-global-feed').click();

  // Back at once, nothing reloaded.
  await expect(role(page, 'global-feed-post').filter({ hasText: text })).toBeVisible({ timeout: 2000 });
  await expect(role(page, 'global-feed-loading')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(directoryRequests).toBe(0);
});
