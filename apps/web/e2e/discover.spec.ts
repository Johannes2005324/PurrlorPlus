import { expect, test } from '@playwright/test';
import { logIn, role } from './app';
import { api, createUser, uniqueName } from './matrix';

test('Discover lists public Spaces, not their channels, and joins one', async ({ page }) => {
  const [owner, visitor] = await Promise.all([createUser('owner'), createUser('visitor')]);
  const name = uniqueName('Discoverable');
  // A public Space with a public channel in it, both listed in the directory.
  const { room_id: spaceId } = await api<{ room_id: string }>(owner, 'POST', '/createRoom', {
    name,
    preset: 'public_chat',
    visibility: 'public',
    creation_content: { type: 'm.space' },
  });
  const { room_id: channelId } = await api<{ room_id: string }>(owner, 'POST', '/createRoom', {
    name: `${name} general`,
    preset: 'public_chat',
    visibility: 'public',
    initial_state: [{ type: 'm.space.parent', state_key: spaceId, content: { via: ['localhost'], canonical: true } }],
  });
  await api(owner, 'PUT', `/rooms/${encodeURIComponent(spaceId)}/state/m.space.child/${encodeURIComponent(channelId)}`, { via: ['localhost'] });

  await logIn(page, visitor);
  await role(page, 'server-rail-discover').click();
  await role(page, 'discover-search-input').fill(name);
  await role(page, 'discover-search-input').press('Enter');
  const rows = role(page, 'discover-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(name);
  await expect(rows.first()).not.toContainText('general');

  await role(rows.first(), 'discover-join').click();
  await expect(role(page, 'discover-list')).toBeHidden();
  // Joining a Space opens it: Chat's column shows its channels, with a way back.
  await expect(role(page, 'chat-back')).toBeVisible();
  await expect(page.locator('.nu-channel-list').getByText(name).first()).toBeVisible();
});
