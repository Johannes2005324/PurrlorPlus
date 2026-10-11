import { expect, test, type Browser, type Page } from '@playwright/test';
import { logIn, role } from './app';
import { api, createSpaceWithChannel, createUser, eventually, type TestUser } from './matrix';

/**
 * A real call, through the LiveKit in e2e/docker-compose.yml. Chrome's fake microphone plays a
 * steady tone, so everyone in these calls is always talking.
 */

const enc = encodeURIComponent;
const TOKEN_SERVER = process.env.E2E_TOKEN_SERVER ?? 'http://127.0.0.1:6168';
const LIVEKIT = process.env.E2E_LIVEKIT ?? 'ws://127.0.0.1:7880';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
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
      (m) => m.membership === 'join'
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
