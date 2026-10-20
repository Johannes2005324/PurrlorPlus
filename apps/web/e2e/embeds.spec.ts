import { expect, test, type Page } from '@playwright/test';
import { clickMessageAction, logIn, message, openChannel, role } from './app';
import { api, createSpaceWithChannel, createUser, eventually, latestEvents, uniqueName } from './matrix';

/**
 * Link embeds (docs/embeds.md): the sender's app asks the token server to resolve a link, shows
 * what it'll embed, uploads its picture and stores the embed in the message, and everyone draws
 * that. The linked page is one the token server serves (its link card for a profile), which the
 * e2e setup alone lets it fetch (EMBEDS_TEST_ALLOW_HOSTS), so nothing comes from the internet.
 */

const TOKEN_SERVER = process.env.E2E_TOKEN_SERVER ?? 'http://127.0.0.1:6168';
const LINK = 'http://token-server:3001/api/public/card/nobody-here';
const enc = encodeURIComponent;

/** The app's public API is the token server's; in a deployment nginx routes it there. */
async function routePublicApi(page: Page, seen: string[] = []): Promise<void> {
  await page.route('**/api/public/**', async (route) => {
    const url = new URL(route.request().url());
    seen.push(url.pathname);
    const response = await route.fetch({ url: `${TOKEN_SERVER}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}

async function typeAndWaitForPreview(page: Page, text: string) {
  const input = role(page, 'composer-input');
  await input.click();
  await input.fill(text);
  const preview = role(page, 'composer-embed').filter({ hasText: 'Purrlor on localhost' });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

test('a link in a channel message is embedded: previewed while typing, stored in the message, drawn for everyone', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  await routePublicApi(page);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  const text = uniqueName('have a look');
  await typeAndWaitForPreview(page, `${text} ${LINK}`);
  await role(page, 'composer-input').press('Enter');

  const embed = role(message(page, text), 'embed');
  await expect(embed).toContainText('Purrlor on localhost', { timeout: 30_000 });
  // The homeserver's preview isn't asked as well.
  await expect(role(message(page, text), 'link-preview-card')).toHaveCount(0);

  // On the server: the embed is in the message itself, for every reader.
  const events = await eventually(
    () => latestEvents(bob, channelId),
    (evs) => evs.some((e) => typeof e.content.body === 'string' && e.content.body.startsWith(text))
  );
  const sent = events.find((e) => typeof e.content.body === 'string' && e.content.body.startsWith(text))!;
  const stored = sent.content['xyz.nekous.embeds'] as { url: string; kind: string; title?: string }[];
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ url: LINK, kind: 'card', title: 'Purrlor on localhost' });

  // The × on your own message's embed edits it out.
  await embed.hover();
  await role(embed, 'embed-remove').click();
  await expect(role(message(page, text), 'embed')).toHaveCount(0);
  await eventually(
    () => latestEvents(alice, channelId),
    (evs) =>
      evs.some((e) => {
        const embeds = (e.content['m.new_content'] as Record<string, unknown> | undefined)?.['xyz.nekous.embeds'];
        return Array.isArray(embeds) && embeds.length === 0;
      })
  );
});

test('an embed removed in the composer is sent without, and the homeserver isn’t asked instead', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await createSpaceWithChannel(alice);
  await routePublicApi(page);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');

  const text = uniqueName('no card please');
  const preview = await typeAndWaitForPreview(page, `${text} ${LINK}`);
  await role(preview, 'composer-embed-remove').click();
  await expect(role(page, 'composer-embed')).toHaveCount(0);
  await role(page, 'composer-input').press('Enter');
  await expect(message(page, text)).toBeVisible();

  const events = await eventually(
    () => latestEvents(alice, channelId),
    (evs) => evs.some((e) => typeof e.content.body === 'string' && e.content.body.startsWith(text))
  );
  expect(events.find((e) => typeof e.content.body === 'string' && e.content.body.startsWith(text))!.content['xyz.nekous.embeds']).toEqual([]);
  await page.waitForTimeout(2000);
  await expect(role(message(page, text), 'embed')).toHaveCount(0);
  await expect(role(message(page, text), 'link-preview-card')).toHaveCount(0);
});

test('a link in an encrypted chat gets no embed, and its link goes nowhere', async ({ page }) => {
  const alice = await createUser('alice');
  const name = uniqueName('secret');
  await api(alice, 'POST', '/createRoom', {
    name,
    preset: 'private_chat',
    initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });
  const seen: string[] = [];
  await routePublicApi(page, seen);
  await logIn(page, alice);
  await role(page, 'server-rail-chat').click();
  await role(page, 'channel-list-item').filter({ hasText: name }).getByText(name, { exact: true }).click();
  const input = role(page, 'composer-input');
  await input.click();
  await input.fill(`private ${LINK}`);
  await page.waitForTimeout(2000);
  await expect(role(page, 'composer-embed')).toHaveCount(0);
  await input.press('Enter');
  await expect(message(page, 'private')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(role(message(page, 'private'), 'embed')).toHaveCount(0);
  expect(seen.filter((path) => path.startsWith('/api/public/embeds'))).toEqual([]);
});

test('a post’s embed is stored with it and shown on the public web', async ({ page }) => {
  const alice = await createUser('alice');
  await routePublicApi(page);
  await logIn(page, alice);
  await role(page, 'server-rail-global-feed').click();
  const text = uniqueName('worth reading');
  await role(page, 'feed-composer-input').fill(`${text} ${LINK}`);
  await expect(role(page, 'composer-embed').filter({ hasText: 'Purrlor on localhost' })).toBeVisible({ timeout: 30_000 });
  await role(page, 'feed-composer-submit').click();
  const post = role(page, 'global-feed-post').filter({ hasText: text });
  await expect(role(post, 'embed')).toContainText('Purrlor on localhost', { timeout: 30_000 });

  // Signed out, through the public API: the post carries its embed as a card.
  const { roomId } = await api<{ roomId: string }>(alice, 'GET', `/user/${enc(alice.userId)}/account_data/xyz.nekous.profile_room`);
  const events = await latestEvents(alice, roomId);
  const eventId = events.find((e) => typeof e.content.body === 'string' && e.content.body.startsWith(text))!.event_id;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${TOKEN_SERVER}/api/public/posts/${enc(eventId)}?author=${alice.localpart}`);
        if (!res.ok) return undefined;
        const answer = (await res.json()) as { posts: { embeds?: { kind: string; title?: string }[] }[] };
        return answer.posts[0]?.embeds?.[0];
      },
      { timeout: 60_000, intervals: [3000] }
    )
    .toMatchObject({ kind: 'card', title: 'Purrlor on localhost' });
});

test('a message’s edit keeps its embed and adds one for a new link', async ({ page }) => {
  const alice = await createUser('alice');
  const { channelId, spaceName } = await createSpaceWithChannel(alice);
  await routePublicApi(page);
  await logIn(page, alice);
  await openChannel(page, spaceName, 'general');
  const text = uniqueName('plain at first');
  const input = role(page, 'composer-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await expect(message(page, text)).toBeVisible();

  await clickMessageAction(message(page, text), 'timeline-edit-action');
  const editor = role(page, 'timeline-edit-input');
  await editor.fill(`${text} now with ${LINK}`);
  await editor.press('Enter');
  await expect(role(message(page, text), 'embed')).toContainText('Purrlor on localhost', { timeout: 30_000 });
  await eventually(
    () => latestEvents(alice, channelId),
    (evs) =>
      evs.some((e) => {
        const embeds = (e.content['m.new_content'] as Record<string, unknown> | undefined)?.['xyz.nekous.embeds'];
        return Array.isArray(embeds) && embeds.length === 1;
      })
  );
});
