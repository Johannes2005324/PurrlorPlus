import { expect, test } from '@playwright/test';
import { logIn, message, role, send } from './app';
import { api, createUser, eventually, latestEvents, uniqueName } from './matrix';

test('an encrypted chat between two browsers', async ({ browser }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const name = uniqueName('secret');
  const { room_id: roomId } = await api<{ room_id: string }>(alice, 'POST', '/createRoom', {
    name,
    preset: 'private_chat',
    invite: [bob.userId],
    initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });
  await api(bob, 'POST', `/join/${encodeURIComponent(roomId)}`, {});

  // Both sign in before anything is sent, so each has a device the other's client can encrypt to.
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  await Promise.all([logIn(alicePage, alice), logIn(bobPage, bob)]);

  for (const page of [alicePage, bobPage]) {
    // The app opens on Home; the conversation is in Messages.
    await role(page, 'server-rail-chat').click();
    await role(page, 'channel-list-item').filter({ hasText: name }).getByText(name, { exact: true }).click();
    await expect(role(page, 'composer-input')).toBeVisible();
  }

  await send(alicePage, 'only we can read this');
  await expect(message(bobPage, 'only we can read this')).toBeVisible();

  // And the server only ever saw ciphertext.
  const events = await eventually(
    () => latestEvents(bob, roomId),
    (evs) => evs.some((e) => e.type === 'm.room.encrypted' && e.sender === alice.userId)
  );
  expect(JSON.stringify(events)).not.toContain('only we can read this');

  await send(bobPage, 'agreed');
  await expect(message(alicePage, 'agreed')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});
