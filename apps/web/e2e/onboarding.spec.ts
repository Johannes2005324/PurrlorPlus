import { expect, test, type Page } from '@playwright/test';
import { logIn, role } from './app';
import { api, createUser, eventually, uniqueName, type TestUser } from './matrix';

/**
 * Someone new (features/onboarding/): the welcome guide opens by itself, joins a public Space and
 * opens it, and never comes back once seen; someone who skips it gets the ways in on the empty
 * screen, an invite link pasted there included; Account Settings opens the guide again.
 */

const enc = encodeURIComponent;

async function makeSpace(owner: TestUser, { listed }: { listed: boolean }): Promise<{ spaceId: string; name: string }> {
  const name = uniqueName(listed ? 'Cat Club' : 'Secret Club');
  const { room_id: spaceId } = await api<{ room_id: string }>(owner, 'POST', '/createRoom', {
    name,
    preset: 'public_chat',
    visibility: listed ? 'public' : 'private',
    creation_content: { type: 'm.space' },
  });
  return { spaceId, name };
}

/** Chat's column is showing this Space's channels. */
const inSpace = async (page: Page, name: string) => {
  await expect(role(page, 'chat-back')).toBeVisible();
  await expect(page.locator('.nu-channel-list').getByText(name).first()).toBeVisible();
};

test('someone new is welcomed, joins a public Space from the guide, and lands in it', async ({ page }) => {
  const owner = await createUser('owner');
  const { name } = await makeSpace(owner, { listed: true });
  const fresh = await createUser('newbie', { welcomed: false });

  await logIn(page, fresh);
  const guide = role(page, 'welcome-guide');
  await expect(guide).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to Purrlor' })).toBeVisible();

  // Who you are.
  await role(page, 'welcome-name').fill('New Kitten');
  await role(page, 'welcome-next').click();

  // Join a Space, from this server's public ones: found by name, since a server can list many.
  await role(page, 'welcome-space-search').fill(name);
  const space = role(page, 'welcome-space').filter({ hasText: name });
  await role(space, 'welcome-space-join').click();
  await expect(role(space, 'welcome-space-join')).toHaveText('Joined');
  await expect(role(page, 'welcome-joined')).toContainText(name);
  await role(page, 'welcome-next').click();

  // The tour, then done.
  await expect(role(page, 'welcome-step-tour')).toContainText('Global feed');
  await role(page, 'welcome-next').click();
  await role(page, 'welcome-finish').click();
  await expect(guide).toBeHidden();
  await inSpace(page, name);

  // Seen: saved to the account, and the name with it.
  await eventually(
    () => api<{ done?: boolean }>(fresh, 'GET', `/user/${enc(fresh.userId)}/account_data/xyz.nekous.onboarding`).catch(() => ({ done: false })),
    (data) => data.done === true
  );
  expect((await api<{ displayname?: string }>(fresh, 'GET', `/profile/${enc(fresh.userId)}`)).displayname).toBe('New Kitten');
  await page.reload();
  await expect(role(page, 'server-rail')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(guide).toBeHidden();
});

test('someone who skips the guide gets the ways in, and joins with a pasted invite link', async ({ page }) => {
  const owner = await createUser('owner');
  // Not listed in the directory: only a link gets you there.
  const { spaceId, name } = await makeSpace(owner, { listed: false });
  const fresh = await createUser('newbie', { welcomed: false });

  await logIn(page, fresh);
  await role(page, 'welcome-skip').click();
  await expect(role(page, 'welcome-guide')).toBeHidden();
  const empty = role(page, 'no-spaces-yet');
  await expect(empty).toContainText('You’re not in any Spaces yet');

  // Something that isn't a link says so.
  await role(empty, 'join-with-link-input').fill('cats please');
  await role(empty, 'join-with-link-submit').click();
  await expect(empty).toContainText('doesn’t look like an invite link');

  // A Purrlor invite link, as Space Settings makes them.
  await role(empty, 'join-with-link-input').fill(`https://some-purrlor.example/?invite=${enc(spaceId)}&via=localhost`);
  await role(empty, 'join-with-link-submit').click();
  await inSpace(page, name);

  // And the guide opens again from Account Settings.
  await role(page, 'server-rail-settings').click();
  await role(page, 'account-settings-show-welcome').click();
  await expect(role(page, 'welcome-guide')).toBeVisible();
});
