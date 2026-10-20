import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { logIn, openApp, openChannel, role, send } from './app';
import { HOMESERVER, api, createSpaceWithChannel, createUser, eventually, latestEvents, sendText, uniqueName } from './matrix';

/**
 * Account Settings → Your data: "Download my data" gives a ZIP of what you sent (decrypted, your
 * files included, nobody else's messages), and "Delete my account" takes down your posts and page
 * before the account is deactivated.
 */

const TOKEN_SERVER = process.env.E2E_TOKEN_SERVER ?? 'http://127.0.0.1:6168';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Reads a stored (uncompressed) ZIP, as the app writes them: name → bytes. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + bytes.readUInt16LE(local + 26);
    files.set(name, bytes.subarray(start, start + size));
    at += 46 + nameLength;
  }
  return files;
}

async function openYourData(page: Page): Promise<void> {
  await role(page, 'server-rail-settings').click();
  await role(page, 'account-settings-data-tab').click();
  await expect(role(page, 'your-data-settings')).toBeVisible();
}

async function postGlobal(page: Page, text: string): Promise<void> {
  await role(page, 'server-rail-global-feed').click();
  await role(page, 'feed-composer-input').fill(text);
  await role(page, 'feed-composer-submit').click();
  await expect(role(page, 'global-feed-post').filter({ hasText: text })).toBeVisible();
}

test('Download my data: what you sent, decrypted, with your files, and nobody else’s messages', async ({ page }) => {
  test.setTimeout(180_000);
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  await sendText(bob, channelId, 'a line from bob');
  const secretRoom = uniqueName('secret');
  await api(alice, 'POST', '/createRoom', {
    name: secretRoom,
    preset: 'private_chat',
    initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });

  await logIn(page, alice);
  const postText = uniqueName('my exported post');
  await postGlobal(page, postText);
  await openChannel(page, spaceName, 'general');
  await send(page, 'hello from alice');
  await role(page, 'composer-file-input').setInputFiles({ name: 'swatch.png', mimeType: 'image/png', buffer: PNG });
  await role(page, 'composer-input').press('Enter');
  await eventually(
    () => latestEvents(alice, channelId),
    (evs) => evs.some((e) => e.content.msgtype === 'm.image')
  );
  // A room in no Space is listed with the conversations, outside any Space.
  await role(page, 'server-rail-chat').click();
  await role(page, 'channel-list-item').filter({ hasText: secretRoom }).getByText(secretRoom, { exact: true }).click();
  await send(page, 'only alice can read this');

  await openYourData(page);
  const download = page.waitForEvent('download');
  await role(page, 'your-data-export-start').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(new RegExp(`^purrlor-${alice.localpart}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
  await expect(role(page, 'your-data-export-done')).toContainText('1 file');

  const zip = unzip(await readFile((await file.path())!));
  const names = [...zip.keys()];
  expect(names).toEqual(expect.arrayContaining(['README.txt', 'account.json', 'posts/Global.json']));
  const all = names.filter((name) => name.startsWith('messages/')).map((name) => zip.get(name)!.toString('utf8')).join('\n');
  expect(all).toContain('hello from alice');
  // Encrypted on the server, plain text in the export.
  expect(all).toContain('only alice can read this');
  expect(all).not.toContain('a line from bob');
  expect(zip.get('posts/Global.json')!.toString('utf8')).toContain(postText);
  expect(JSON.parse(zip.get('account.json')!.toString('utf8')).userId).toBe(alice.userId);
  expect(zip.get('account.json')!.toString('utf8')).not.toMatch(/m\.secret_storage|m\.cross_signing/);
  const image = names.find((name) => name.startsWith('media/'));
  expect(image).toBe('media/swatch.png');
  expect(zip.get(image!)!.equals(PNG)).toBe(true);
});

test('Delete my account: the password is checked first, posts and page go, and the account is closed', async ({ page, request }) => {
  test.setTimeout(180_000);
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  await logIn(page, alice);
  const postText = uniqueName('soon gone');
  await postGlobal(page, postText);
  const { roomId: profileRoomId } = await api<{ roomId: string }>(
    alice,
    'GET',
    `/user/${encodeURIComponent(alice.userId)}/account_data/xyz.nekous.profile_room`
  );
  await api(alice, 'PUT', `/rooms/${encodeURIComponent(profileRoomId)}/state/xyz.nekous.public_web/`, { enabled: true });

  await openYourData(page);
  await role(page, 'your-data-delete-start').click();
  await role(page, 'delete-account-password').fill('not my password');
  await role(page, 'delete-account-confirm').click();
  await expect(role(page, 'delete-account-error')).toContainText('isn’t right');
  // Nothing was touched by the wrong password.
  const stillThere = await api<{ chunk: { type: string; content: Record<string, unknown> }[] }>(
    alice,
    'GET',
    `/rooms/${encodeURIComponent(profileRoomId)}/messages?dir=b&limit=20`
  );
  expect(JSON.stringify(stillThere.chunk)).toContain(postText);

  await role(page, 'delete-account-password').fill(alice.password);
  await role(page, 'delete-account-confirm').click();
  await expect(role(page, 'login-account-deleted')).toBeVisible({ timeout: 60_000 });

  // The account can't sign in again.
  const login = await fetch(`${HOMESERVER}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user: alice.localpart }, password: alice.password }),
  });
  expect((await login.json()).errcode).toBe('M_USER_DEACTIVATED');

  // The post is deleted (Bob reads the room, which is world-readable) and the page switched off.
  const left = await api<{ chunk: { type: string; content: Record<string, unknown> }[] }>(
    bob,
    'GET',
    `/rooms/${encodeURIComponent(profileRoomId)}/messages?dir=b&limit=50`
  );
  expect(JSON.stringify(left.chunk)).not.toContain(postText);
  const publicWeb = await api<{ enabled?: boolean }>(bob, 'GET', `/rooms/${encodeURIComponent(profileRoomId)}/state/xyz.nekous.public_web/`);
  expect(publicWeb.enabled).toBe(false);

  // And the public web shows nothing of them.
  const page404 = await request.get(`${TOKEN_SERVER}/api/public/pages/${alice.localpart}`);
  expect(page404.status()).toBe(404);

  // The sign-in screen says it once; a reload doesn't.
  await openApp(page);
  await expect(role(page, 'login-account-deleted')).toBeHidden();
});
