import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { logIn, openChannel, role } from './app';
import { HOMESERVER, api, createSpaceWithChannel, createUser, uniqueName, type TestUser } from './matrix';

const enc = encodeURIComponent;

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A plain orange PNG of the given size: big enough that the app shows a thumbnail of it. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([255, 140, 0], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(user: TestUser, bytes: Buffer, type: string): Promise<string> {
  const res = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=big.png`, {
    method: 'POST',
    headers: { 'Content-Type': type, Authorization: `Bearer ${user.accessToken}` },
    body: bytes,
  });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { content_uri: string }).content_uri;
}

// The homeserver wants an access token on media, which an <img> can't send: the service worker
// (public/sw.js, matrix/mediaWorker.ts) adds it, so the image loads from its URL rather than as a
// blob of the whole file fetched first. Inline it's a thumbnail; the lightbox has the whole file.
test('an image loads from its URL through the service worker, as a thumbnail, and opens whole', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  const bytes = png(1600, 1200);
  const mxc = await upload(bob, bytes, 'image/png');
  await api(bob, 'PUT', `/rooms/${enc(channelId)}/send/m.room.message/${uniqueName('txn')}`, {
    msgtype: 'm.image',
    body: 'big.png',
    url: mxc,
    info: { mimetype: 'image/png', w: 1600, h: 1200, size: bytes.length },
  });

  await logIn(page, alice);
  // The worker takes over the page once it has installed; media goes through it from then on.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await openChannel(page, spaceName, 'general');

  const inline = role(page, 'timeline-image').locator('img');
  await expect(inline).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:6167\/_matrix\/client\/v1\/media\/thumbnail\/.*width=800/);
  await expect.poll(() => inline.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await role(page, 'timeline-image').click();
  const whole = role(page, 'lightbox').locator('img');
  await expect(whole).toHaveAttribute('src', /\/_matrix\/client\/v1\/media\/download\//);
  await expect.poll(() => whole.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600);
});

// What was loaded once is kept on the device (public/sw.js): opening the room again, or the app
// again, shows it from there instead of asking the homeserver (and, for another server's media,
// that server) for it again. Signing out deletes it.
test('an image shown once is kept on the device, and signing out deletes it', async ({ page }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { channelId, spaceName } = await createSpaceWithChannel(alice, [bob]);
  const bytes = png(1600, 1200);
  const mxc = await upload(bob, bytes, 'image/png');
  await api(bob, 'PUT', `/rooms/${enc(channelId)}/send/m.room.message/${uniqueName('txn')}`, {
    msgtype: 'm.image',
    body: 'big.png',
    url: mxc,
    info: { mimetype: 'image/png', w: 1600, h: 1200, size: bytes.length },
  });

  await logIn(page, alice);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await openChannel(page, spaceName, 'general');
  const inline = role(page, 'timeline-image').locator('img');
  await expect.poll(() => inline.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const src = await inline.getAttribute('src');

  const cached = () => page.evaluate(async (url) => !!(await (await caches.open('purrlor-media-v1')).match(url!)), src);
  await expect.poll(cached).toBe(true);

  await role(page, 'server-rail-settings').click();
  await role(page, 'user-panel-logout').click();
  await expect(role(page, 'login-screen')).toBeVisible();
  expect(await page.evaluate(() => caches.has('purrlor-media-v1'))).toBe(false);
});
