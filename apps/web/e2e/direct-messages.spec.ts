import { expect, test, type Page } from '@playwright/test';
import { logIn, message, openChannel, role, send } from './app';
import { api, createSpaceWithChannel, createUser, eventually, sendText, type TestUser } from './matrix';

/**
 * A DM the way a person starts one: from the other person's profile ("Message"), in a Space whose
 * #general has only the two of them in it, which "Message" once mistook for a DM. The DM is only
 * an invite on the other side until they accept, from Invites or by pressing "Message" back.
 */

async function joinedRooms(user: TestUser): Promise<string[]> {
  const { joined_rooms } = await api<{ joined_rooms: string[] }>(user, 'GET', '/joined_rooms');
  return joined_rooms;
}

/** The rooms `user` is in apart from the Space and its channel: their DMs. */
async function dmRooms(user: TestUser, space: { spaceId: string; channelId: string }): Promise<string[]> {
  return (await joinedRooms(user)).filter((id) => id !== space.spaceId && id !== space.channelId);
}

async function messageFromProfile(page: Page, spaceName: string, other: TestUser): Promise<void> {
  await openChannel(page, spaceName, 'general');
  await role(page, 'member-list-item').filter({ hasText: other.localpart }).click();
  await role(page, 'user-profile-message').click();
  await expect(role(page, 'user-profile')).toBeHidden();
  await expect(role(page, 'composer-input')).toBeVisible();
}

async function setUp(browser: import('@playwright/test').Browser) {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const space = await createSpaceWithChannel(alice, [bob]);
  // Both sign in before anything is sent, so each has a device the other's client encrypts to.
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  await Promise.all([logIn(alicePage, alice), logIn(bobPage, bob)]);
  return { alice, bob, space, alicePage, bobPage, close: () => Promise.all([aliceContext.close(), bobContext.close()]) };
}

/** Alice messages Bob, comes back later through his profile again, and it's the same DM. */
async function aliceStartsAndRevisits({ alice, bob, space, alicePage }: Awaited<ReturnType<typeof setUp>>): Promise<string> {
  await messageFromProfile(alicePage, space.spaceName, bob);
  await send(alicePage, 'hey bob, first one');

  const [dmId] = await eventually(
    () => dmRooms(alice, space),
    (rooms) => rooms.length === 1
  );
  const { chunk: members } = await api<{ chunk: { state_key: string; content: { membership: string } }[] }>(
    alice,
    'GET',
    `/rooms/${encodeURIComponent(dmId)}/members`
  );
  expect(members.find((m) => m.state_key === bob.userId)?.content.membership).toBe('invite');

  // Elsewhere, then back through his profile while he still hasn't accepted.
  await messageFromProfile(alicePage, space.spaceName, bob);
  await expect(message(alicePage, 'hey bob, first one')).toBeVisible();
  await send(alicePage, 'and a second one');
  expect(await dmRooms(alice, space)).toEqual([dmId]);
  return dmId;
}

/** Bob, now in the DM, reads both, and the conversation carries on both ways in that one room. */
async function bobReadsAndReplies(ctx: Awaited<ReturnType<typeof setUp>>, dmId: string): Promise<void> {
  const { alice, bob, space, alicePage, bobPage } = ctx;
  await expect(message(bobPage, 'hey bob, first one')).toBeVisible();
  await expect(message(bobPage, 'and a second one')).toBeVisible();
  await send(bobPage, 'hi alice');
  await expect(message(alicePage, 'hi alice')).toBeVisible();
  expect(await dmRooms(bob, space)).toEqual([dmId]);
  expect(await dmRooms(alice, space)).toEqual([dmId]);
}

test('Message on a profile opens one DM, and pressing Message back accepts it', async ({ browser }) => {
  const ctx = await setUp(browser);
  const dmId = await aliceStartsAndRevisits(ctx);

  await messageFromProfile(ctx.bobPage, ctx.space.spaceName, ctx.alice);
  await bobReadsAndReplies(ctx, dmId);

  // And Bob going back through her profile lands in the same DM too.
  await messageFromProfile(ctx.bobPage, ctx.space.spaceName, ctx.alice);
  await expect(message(ctx.bobPage, 'hi alice')).toBeVisible();
  await ctx.close();
});

test('a DM accepted from Invites opens that same conversation', async ({ browser }) => {
  const ctx = await setUp(browser);
  const dmId = await aliceStartsAndRevisits(ctx);

  await role(ctx.bobPage, 'server-rail-notifications').click();
  await role(ctx.bobPage, 'activity-invites').click();
  await role(ctx.bobPage, 'invite-row').filter({ hasText: ctx.alice.localpart }).locator('[data-nu-role="invite-accept"]').click();
  await expect(role(ctx.bobPage, 'composer-input')).toBeVisible();
  await bobReadsAndReplies(ctx, dmId);
  await ctx.close();
});

/** A DM the other person started earlier and that's well under way: the kind the client hasn't
 *  loaded the members of when it starts (it lazy-loads them), which "Message" took for an empty
 *  room and so started another DM beside it. */
async function earlierDm(alice: TestUser, bob: TestUser): Promise<string> {
  const { room_id: dmId } = await api<{ room_id: string }>(bob, 'POST', '/createRoom', {
    preset: 'trusted_private_chat',
    invite: [alice.userId],
    is_direct: true,
  });
  await api(alice, 'POST', `/join/${encodeURIComponent(dmId)}`, {});
  await sendText(bob, dmId, 'from bob, a while ago');
  // Enough of Alice's own after it that Bob's join and message fall outside her first sync.
  for (let i = 0; i < 40; i += 1) await sendText(alice, dmId, `alice rambling ${i}`);
  return dmId;
}

test("Message reopens a DM you've had for a while, rather than starting another", async ({ browser }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const space = await createSpaceWithChannel(alice, [bob]);
  const dmId = await earlierDm(alice, bob);
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, alice);

  await messageFromProfile(page, space.spaceName, bob);
  await expect(message(page, 'alice rambling 39')).toBeVisible();
  await send(page, 'still the same chat');
  expect(await dmRooms(alice, space)).toEqual([dmId]);
  await context.close();
});

test('leaving a DM takes it off your list', async ({ browser }) => {
  const [alice, bob] = await Promise.all([createUser('alice'), createUser('bob')]);
  const dmId = await earlierDm(alice, bob);
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, alice);

  await role(page, 'server-rail-messages').click();
  const row = role(page, 'channel-list-row').filter({ has: role(page, 'channel-list-item').filter({ hasText: bob.localpart }) });
  await expect(row).toBeVisible();
  await row.hover();
  await role(row, 'channel-list-row-menu').click();
  await role(page, 'channel-list-leave').click();
  await role(page, 'confirm-ok').click();

  await expect(row).toBeHidden();
  await eventually(
    () => joinedRooms(alice),
    (rooms) => !rooms.includes(dmId)
  );
  await context.close();
});
