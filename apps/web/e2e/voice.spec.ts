import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { logIn, role } from './app';
import { api, createSpaceWithChannel, createUser, eventually, type TestUser } from './matrix';

/**
 * A real call, through the LiveKit in e2e/docker-compose.yml. Everyone's microphone plays a steady
 * tone (below), so everyone in these calls is always talking.
 */

/**
 * The tone: two seconds of 440 Hz as a WAV file, which Chrome loops as its fake microphone.
 * Chrome's own fake microphone only beeps, with silence between, and on a busy machine LiveKit's
 * "who's talking" could miss the beeps altogether: the speaking checks below failed now and then.
 */
function steadyTone(): string {
  const rate = 48_000;
  const samples = rate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); // bytes per second
  wav.writeUInt16LE(2, 32); // bytes per sample
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * 32767), 44 + i * 2);
  const file = join(tmpdir(), 'purrlor-e2e-tone.wav');
  writeFileSync(file, wav);
  return file;
}

const enc = encodeURIComponent;
const TOKEN_SERVER = process.env.E2E_TOKEN_SERVER ?? 'http://127.0.0.1:6168';
const LIVEKIT = process.env.E2E_LIVEKIT ?? 'ws://127.0.0.1:7880';

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${steadyTone()}`,
      '--autoplay-policy=no-user-gesture-required',
      // Sharing picks the whole (fake) screen without asking.
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  },
});

/** A Space whose voice server is the e2e LiveKit, with a voice channel and the token server's bot in both. */
async function spaceWithVoiceChannel(owner: TestUser, members: TestUser[]) {
  const created = await createSpaceWithChannel(owner, members, 'lounge');
  const { botUserId } = (await (await fetch(`${TOKEN_SERVER}/api/livekit/config`)).json()) as { botUserId: string };
  await api(owner, 'PUT', `/rooms/${enc(created.spaceId)}/state/xyz.nekous.voice_server/`, {
    url: LIVEKIT,
    tokenEndpoint: `${TOKEN_SERVER}/api/livekit/token`,
    botUserId,
  });
  await api(owner, 'PUT', `/rooms/${enc(created.channelId)}/state/xyz.nekous.channel_type/`, { type: 'voice' });
  for (const roomId of [created.spaceId, created.channelId]) {
    await api(owner, 'POST', `/rooms/${enc(roomId)}/invite`, { user_id: botUserId });
    await eventually(
      () => api<{ membership: string }>(owner, 'GET', `/rooms/${enc(roomId)}/state/m.room.member/${enc(botUserId)}`),
      (m) => m.membership === 'join',
      // The bot joins on its next sync; slower with many calls starting at once.
      45_000
    );
  }
  return created;
}

async function joinCall(browser: Browser, user: TestUser, spaceName: string): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const page = await context.newPage();
  await logIn(page, user);
  await page.locator(`[data-nu-role="server-rail-item"][aria-label="${spaceName}"]`).click();
  await role(page, 'channel-list-item').filter({ hasText: 'lounge' }).getByText('lounge', { exact: true }).click();
  await expect(role(page, 'voice-controls')).toBeVisible({ timeout: 45_000 });
  return page;
}

test('in a call, who is talking is lit up, and the list keeps its order', async ({ browser }) => {
  test.setTimeout(180_000);
  const [alice, bob, carol, dave] = await Promise.all([createUser('alice'), createUser('bob'), createUser('carol'), createUser('dave')]);
  const { spaceName } = await spaceWithVoiceChannel(alice, [bob, carol, dave]);

  // One after another, so the join order is alice, bob, carol.
  const alicePage = await joinCall(browser, alice, spaceName);
  const bobPage = await joinCall(browser, bob, spaceName);
  await joinCall(browser, carol, spaceName);
  const joinOrder = [alice, bob, carol].map((u) => u.localpart);

  for (const page of [alicePage, bobPage]) {
    // The call's own list: everyone, who joined first, first, the same for each of them (LiveKit
    // put each person first on their own screen).
    const tiles = page.locator('[data-nu-role="voice-participants"] .nu-voice-participant__name');
    await expect(tiles).toHaveText(joinOrder, { timeout: 30_000 });
    // The tone is talking: someone's lit up.
    await expect(page.locator('.nu-voice-participant--speaking').first()).toBeVisible({ timeout: 20_000 });

    // The channel list's list of who's in the call, live for the call you're in: the same order,
    // and whoever's talking lit up there too.
    const occupants = role(page, 'channel-list-occupants').locator('.nu-channel-list__occupant-name');
    await expect(occupants).toHaveText(joinOrder, { timeout: 30_000 });
    await expect(role(page, 'channel-list-occupant').and(page.locator('[data-nu-speaking]')).first()).toBeVisible({ timeout: 20_000 });
  }

  // Someone not in the call sees the channel list's poll of it (the token server's answer): the
  // same order there too.
  const davePage = await (await browser.newContext()).newPage();
  await logIn(davePage, dave);
  await davePage.locator(`[data-nu-role="server-rail-item"][aria-label="${spaceName}"]`).click();
  await expect(role(davePage, 'channel-list-occupants').locator('.nu-channel-list__occupant-name')).toHaveText(joinOrder, { timeout: 30_000 });

  // And it stays put: no reshuffling as the call goes on.
  const occupants = role(alicePage, 'channel-list-occupants').locator('.nu-channel-list__occupant-name');
  for (let i = 0; i < 3; i++) {
    await alicePage.waitForTimeout(5_500); // past the poll it used to be
    await expect(occupants).toHaveText(joinOrder);
  }
});

test('a screen share is laid out as Watch Together is: the same 16:9 frame, whose it is and pop-out under it', async ({ browser }) => {
  test.setTimeout(180_000);
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceName } = await spaceWithVoiceChannel(alice, [bob]);
  const alicePage = await joinCall(browser, alice, spaceName);
  const bobPage = await joinCall(browser, bob, spaceName);

  // Watch Together first (a share takes its place while there is one), for its frame's size.
  await role(bobPage, 'voice-together-menu').click();
  await role(bobPage, 'voice-watch-together-toggle').click();
  await role(bobPage, 'watch-together-url-input').fill('https://example.org/clip.mp4');
  await bobPage.getByRole('button', { name: 'Start watching' }).click();
  const watchFrame = role(bobPage, 'watch-together').locator('.nu-watch-together__frame');
  await expect(watchFrame).toBeVisible();
  const watched = (await watchFrame.boundingBox())!;
  await bobPage.screenshot({ path: test.info().outputPath('watch-together.png') });

  await role(alicePage, 'voice-screen-share-toggle').click();
  const share = role(bobPage, 'voice-screen-share');
  await expect(share.locator('video')).toBeVisible({ timeout: 30_000 });
  await expect(role(share, 'voice-screen-share-name')).toContainText('’s screen');
  await bobPage.screenshot({ path: test.info().outputPath('screen-share.png') });

  const frame = (await share.locator('.nu-watch-together__frame').boundingBox())!;
  expect(Math.abs(frame.width - watched.width)).toBeLessThan(2);
  expect(Math.abs(frame.height - watched.height)).toBeLessThan(2);
  expect(Math.abs(frame.width / frame.height - 16 / 9)).toBeLessThan(0.02);
  // Under the picture, not over it.
  const popout = (await role(share, 'voice-screen-share-popout').boundingBox())!;
  expect(popout.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);

  // Popped out, the frame keeps its place and says where the share went.
  await role(share, 'voice-screen-share-popout').click();
  await expect(share).toContainText('Popped out into its own window.');
  expect((await share.locator('.nu-watch-together__frame').boundingBox())!.height).toBeCloseTo(frame.height, 0);
});

test('Watch Together’s and a screen share’s volume are each person’s own', async ({ browser }) => {
  test.setTimeout(180_000);
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const { spaceName } = await spaceWithVoiceChannel(alice, [bob]);
  const alicePage = await joinCall(browser, alice, spaceName);
  const bobPage = await joinCall(browser, bob, spaceName);

  await role(bobPage, 'voice-together-menu').click();
  await role(bobPage, 'voice-watch-together-toggle').click();
  await role(bobPage, 'watch-together-url-input').fill('https://example.org/clip.mp4');
  await bobPage.getByRole('button', { name: 'Start watching' }).click();
  const videoVolume = (page: typeof bobPage) => role(page, 'watch-together').locator('video').evaluate((v: HTMLVideoElement) => v.volume);
  await expect.poll(() => videoVolume(alicePage)).toBe(1);

  // Bob turns it down for himself: Alice still hears it at full.
  await role(bobPage, 'watch-together-volume').fill('0.3');
  await expect.poll(() => videoVolume(bobPage)).toBeCloseTo(0.3);
  expect(await videoVolume(alicePage)).toBe(1);
  // Remembered on Bob's device, for the next video too.
  expect(await bobPage.evaluate(() => localStorage.getItem('nekous_watch_together_volume'))).toBe('0.3');

  // A screen share with sound (Chrome's fake screen has some): Bob, watching, can turn it down for
  // himself, and it's remembered; Alice, sharing, isn't played her own and has no slider.
  await role(alicePage, 'voice-screen-share-toggle').click();
  await expect(role(bobPage, 'voice-screen-share').locator('video')).toBeVisible({ timeout: 30_000 });
  await role(bobPage, 'voice-screen-share-volume').fill('0.4');
  expect(await bobPage.evaluate(() => localStorage.getItem('nekous_screen_share_volume'))).toBe('0.4');
  await expect(role(alicePage, 'voice-screen-share').locator('video')).toBeVisible();
  await expect(role(alicePage, 'voice-screen-share-volume')).toHaveCount(0);
});
