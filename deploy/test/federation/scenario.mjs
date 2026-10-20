#!/usr/bin/env node
// The federation scenario (docs/federation.md) against the two test instances docker-compose.yml
// runs: people and rooms on B the way the app makes them, the two instances peered through their
// real control sockets, then what A's people and A's public web can read, the on-demand join, both
// sides' hides, and removing the peer. run.sh starts the instances and runs this.
//
//   node scenario.mjs <A's bootstrap token> <B's bootstrap token>

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE = join(HERE, 'docker-compose.yml');
const A = { hs: 'http://127.0.0.1:6201', app: 'http://127.0.0.1:6202', server: 'hsa.test', tokenService: 'token-a' };
const B = { hs: 'http://127.0.0.1:6211', app: 'http://127.0.0.1:6212', server: 'hsb.test', tokenService: 'token-b' };
const REG = 'fed-registration-token';
const PROFILE = 'xyz.nekous.profile';
const PROFILE_KEY = 'xyz.nekous.profile_room';
const STORY = 'xyz.nekous.story';

const [bootstrapA, bootstrapB] = process.argv.slice(2);
if (!bootstrapA || !bootstrapB) {
  console.error('Usage: node scenario.mjs <A bootstrap token> <B bootstrap token> (run.sh passes them)');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const enc = encodeURIComponent;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

async function call(base, token, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function register(hs, username, password, token) {
  const body = { username, password, inhibit_login: true };
  let res = await call(hs, undefined, 'POST', '/_matrix/client/v3/register', body);
  if (res.status === 401) {
    res = await call(hs, undefined, 'POST', '/_matrix/client/v3/register', {
      ...body,
      auth: { type: 'm.login.registration_token', token, session: res.json?.session },
    });
  }
  if (!res.ok && res.json?.errcode !== 'M_USER_IN_USE') throw new Error(`Registering ${username} on ${hs}: ${res.status} ${res.text}`);
}

async function login(hs, user) {
  const res = await call(hs, undefined, 'POST', '/_matrix/client/v3/login', {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user },
    password: `${user}-password`,
  });
  if (!res.ok) throw new Error(`Logging in ${user}: ${res.text}`);
  return { hs, token: res.json.access_token, userId: res.json.user_id };
}

const as = (who) => (method, path, body) => call(who.hs, who.token, method, path, body);

/** One request to a token server's control socket, from inside its container. */
function ctl(service, method, path, form = {}) {
  const code = `
    const http = require('node:http');
    const [method, path, body] = process.argv.slice(1);
    const req = http.request({ socketPath: '/control/purrlor.sock', method, path, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => { process.stdout.write(res.statusCode + '\\n' + text); });
    });
    req.end(body);`;
  const body = new URLSearchParams({ actor: 'scenario', ...form }).toString();
  // A GET's fields go in its query, as the purrlor command sends them (curl -G).
  const target = method === 'GET' ? `${path}?${body}` : path;
  const out = execFileSync('docker', ['compose', '-f', COMPOSE, 'exec', '-T', service, 'node', '-e', code, method, target, method === 'GET' ? '' : body], {
    encoding: 'utf8',
    timeout: 600_000,
  });
  const newline = out.indexOf('\n');
  return { status: Number(out.slice(0, newline)), text: out.slice(newline + 1) };
}

/** B's global emote library, as `purrlor emotes setup` makes it (docs/api.md), with bob's pack in it. */
async function makeEmoteLibrary(admin, owner) {
  const room = await as(admin)('POST', '/_matrix/client/v3/createRoom', {
    name: 'Emote library',
    room_alias_name: 'purrlor-emotes',
    visibility: 'private',
    creation_content: { type: 'xyz.nekous.emote_library' },
    power_level_content_override: {
      users_default: 0, events_default: 50, state_default: 50, invite: 50, kick: 50, ban: 50, redact: 50,
      events: { 'im.ponies.room_emotes': 0, 'xyz.nekous.emote_moderation': 50, 'm.room.power_levels': 50 },
    },
    initial_state: [
      { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'public' } },
      { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'shared' } },
    ],
  });
  if (!room.ok) throw new Error(`Making B's emote library: ${room.text}`);
  const roomId = room.json.room_id;
  await as(owner)('POST', `/_matrix/client/v3/join/${enc(roomId)}`, {});
  const pack = await as(owner)('PUT', `/_matrix/client/v3/rooms/${enc(roomId)}/state/im.ponies.room_emotes/${enc(owner.userId)}`, {
    images: {
      wave: { url: 'mxc://hsb.test/wave', usage: ['emoticon'], 'xyz.nekous.added_at': 1 },
      stamp: { url: 'mxc://hsb.test/stamp', usage: ['sticker'], body: 'A stamp', 'xyz.nekous.added_at': 2 },
    },
  });
  if (!pack.ok) throw new Error(`Bob's pack: ${pack.text}`);
  return roomId;
}

/** A profile room the way the web client makes one (profileFeed.ts), with a Global post in it. */
async function makeProfile(who, name, postBody) {
  const room = await as(who)('POST', '/_matrix/client/v3/createRoom', {
    name,
    visibility: 'public',
    creation_content: { type: PROFILE },
    power_level_content_override: { events: { 'xyz.nekous.post': 100 } },
    initial_state: [
      { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'public' } },
      { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'world_readable' } },
      { type: 'xyz.nekous.channel_type', state_key: '', content: { type: 'feed' } },
      { type: 'xyz.nekous.feed', state_key: '', content: { owner: who.userId, profile: true } },
      { type: 'xyz.nekous.public_web', state_key: '', content: { enabled: true } },
    ],
  });
  if (!room.ok) throw new Error(`Profile room for ${who.userId}: ${room.text}`);
  const roomId = room.json.room_id;
  await as(who)('PUT', `/_matrix/client/v3/user/${enc(who.userId)}/account_data/${PROFILE_KEY}`, { roomId });
  // The extended profile field, stable or MSC4133's unstable prefix, whichever the server takes.
  const field = await as(who)('PUT', `/_matrix/client/v3/profile/${enc(who.userId)}/${PROFILE_KEY}`, { [PROFILE_KEY]: roomId });
  if (!field.ok) await as(who)('PUT', `/_matrix/client/unstable/uk.tcpip.msc4133/profile/${enc(who.userId)}/${PROFILE_KEY}`, { [PROFILE_KEY]: roomId });
  const post = await as(who)('PUT', `/_matrix/client/v3/rooms/${enc(roomId)}/send/xyz.nekous.post/p${Date.now()}`, { body: postBody });
  // An avatar, for remote media to have something to fetch (a 1x1 PNG).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const upload = await fetch(`${who.hs}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'image/png' },
    body: png,
  }).then((res) => res.json());
  if (upload.content_uri) await as(who)('PUT', `/_matrix/client/v3/profile/${enc(who.userId)}/avatar_url`, { avatar_url: upload.content_uri });
  return { roomId, postId: post.json?.event_id };
}

/** A published page and profile extras, as the page builder and Account Settings write them. */
async function customise(who, roomId, { accent, bio, text }) {
  const page = {
    version: 1,
    style: { colors: { bg: '#101018', text: '#ffffff', accent, link: accent, block: '#202030' }, fonts: { heading: 'display', body: 'figtree' } },
    blocks: [{ id: 'intro', type: 'text', text }],
  };
  await as(who)('PUT', `/_matrix/client/v3/rooms/${enc(roomId)}/state/xyz.nekous.profile_page/`, page);
  const set = await as(who)('PUT', `/_matrix/client/v3/profile/${enc(who.userId)}/xyz.nekous.bio`, { 'xyz.nekous.bio': bio });
  if (!set.ok) await as(who)('PUT', `/_matrix/client/unstable/uk.tcpip.msc4133/profile/${enc(who.userId)}/xyz.nekous.bio`, { 'xyz.nekous.bio': bio });
}

/** A public Space, and its owner's feed room in it with a post (feed.ts). */
async function makeSpaceWithFeed(who) {
  const space = await as(who)('POST', '/_matrix/client/v3/createRoom', {
    name: 'Cat Cafe',
    visibility: 'public',
    creation_content: { type: 'm.space' },
    initial_state: [
      { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'public' } },
      { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'world_readable' } },
    ],
  });
  const spaceId = space.json.room_id;
  const feed = await as(who)('POST', '/_matrix/client/v3/createRoom', {
    name: `${who.userId}'s posts`,
    power_level_content_override: { events: { 'xyz.nekous.post': 100 } },
    initial_state: [
      { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'restricted', allow: [{ type: 'm.room_membership', room_id: spaceId }] } },
      { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'world_readable' } },
      { type: 'xyz.nekous.channel_type', state_key: '', content: { type: 'feed' } },
      { type: 'xyz.nekous.feed', state_key: '', content: { owner: who.userId, spaceId } },
    ],
  });
  const feedId = feed.json.room_id;
  const member = await as(who)('GET', `/_matrix/client/v3/rooms/${enc(spaceId)}/state/m.room.member/${enc(who.userId)}`);
  await as(who)('PUT', `/_matrix/client/v3/rooms/${enc(spaceId)}/state/m.room.member/${enc(who.userId)}`, {
    ...member.json,
    membership: 'join',
    'xyz.nekous.feed_room': feedId,
  });
  await as(who)('PUT', `/_matrix/client/v3/rooms/${enc(feedId)}/send/xyz.nekous.post/s${Date.now()}`, { body: 'posted in the Cat Cafe' });
  return { spaceId, feedId };
}

async function readable(who, roomId) {
  const res = await as(who)('GET', `/_matrix/client/v3/rooms/${enc(roomId)}/messages?dir=b&limit=50`);
  return { ok: res.ok, posts: (res.json?.chunk ?? []).filter((event) => event.type === 'xyz.nekous.post').map((event) => event.content?.body) };
}

async function until(what, fn, { timeout = 90_000, every = 3000 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  console.log(`      (gave up waiting for ${what})`);
  return last;
}

async function main() {
  console.log('Accounts');
  await register(A.hs, 'fed-admin', 'fed-admin-password', bootstrapA);
  await register(B.hs, 'fed-admin', 'fed-admin-password', bootstrapB);
  for (const [server, names] of [
    [A, ['fed-bot', 'alice', 'a2']],
    [B, ['fed-bot', 'bob', 'carol']],
  ]) {
    for (const name of names) await register(server.hs, name, name === 'fed-bot' ? 'fed-bot-password' : `${name}-password`, REG);
  }
  const alice = await login(A.hs, 'alice');
  const bob = await login(B.hs, 'bob');
  const carol = await login(B.hs, 'carol');

  console.log('People and rooms on B');
  const bobProfile = await makeProfile(bob, 'Bob', 'hello from bob on B');
  const carolProfile = await makeProfile(carol, 'Carol', 'hello from carol on B');
  const cafe = await makeSpaceWithFeed(bob);
  await customise(bob, bobProfile.roomId, { accent: '#ff3366', bio: 'bob’s bio on B', text: 'Welcome to my page' });
  const bAdmin = await login(B.hs, 'fed-admin');
  const library = await makeEmoteLibrary(bAdmin, bob);

  // The two homeservers must reach each other before anything else means anything.
  const dir = await until('A to read B’s directory over federation', async () => {
    const res = await as(alice)('POST', `/_matrix/client/v3/publicRooms?server=${B.server}`, { limit: 50 });
    return res.ok && res.json.chunk.length >= 3 ? res : undefined;
  });
  check('A reads B’s room directory over federation', !!dir?.ok, dir ? `${dir.json.chunk.length} rooms` : 'never answered');
  if (!dir?.ok) return;

  check('before peering, A can’t read B’s profile room', !(await readable(alice, bobProfile.roomId)).ok);

  console.log('Peering');
  const instance = await call(B.app, undefined, 'GET', '/api/public/instance');
  check('B describes itself', instance.json?.serverName === B.server && instance.json?.federation === 1, instance.text);
  const addB = ctl(A.tokenService, 'POST', '/peers/add', { url: 'https://appb.test', reason: 'scenario' });
  check('A adds B as a peer', addB.status === 200, addB.text.trim());
  const addA = ctl(B.tokenService, 'POST', '/peers/add', { url: 'https://appa.test', reason: 'scenario' });
  check('B adds A as a peer', addA.status === 200, addA.text.trim());
  const sync = ctl(A.tokenService, 'POST', '/peers/sync');
  check('A’s bot syncs B', sync.status === 200, sync.text.trim());
  console.log(ctl(A.tokenService, 'GET', '/peers').text.trim().replace(/^/gm, '      '));
  const peers = await call(A.app, undefined, 'GET', '/api/public/peers');
  check('A lists B for its app', peers.json?.peers?.[0]?.serverName === B.server, peers.text);

  console.log('What A’s people can read');
  // PEER_MAX_PROFILES=1: the bot joined one of B's two profile rooms from the directory.
  const bobRead = await until('one of B’s profiles to be readable', async () => {
    const [b, c] = [await readable(alice, bobProfile.roomId), await readable(alice, carolProfile.roomId)];
    return b.ok || c.ok ? { b, c } : undefined;
  });
  const listedOne = bobRead?.b.ok ? 'bob' : 'carol';
  const other = listedOne === 'bob' ? { who: carol, room: carolProfile.roomId } : { who: bob, room: bobProfile.roomId };
  check(`alice reads ${listedOne}’s Global posts without joining (the bot did)`, !!bobRead && (bobRead.b.posts.length > 0 || bobRead.c.posts.length > 0));
  check('the other profile is past the cap, so not readable yet', !(await readable(alice, other.room)).ok);
  const feedRead = await until('B’s Space feed to be readable', async () => {
    const r = await readable(alice, cafe.feedId);
    return r.ok && r.posts.length ? r : undefined;
  });
  check('alice reads bob’s post in B’s public Space without joining', !!feedRead, feedRead?.posts.join(' | '));

  const openid = (await as(alice)('POST', `/_matrix/client/v3/user/${enc(alice.userId)}/openid/request_token`, {})).json;
  const wrong = await call(A.app, undefined, 'POST', '/api/public/peers/join', { openid_token: openid, user_id: other.who.userId, room_id: listedOne === 'bob' ? bobProfile.roomId : carolProfile.roomId });
  check('the on-demand join refuses a room that isn’t that person’s', wrong.status === 404, wrong.text);
  const join = await call(A.app, undefined, 'POST', '/api/public/peers/join', { openid_token: openid, user_id: other.who.userId, room_id: other.room });
  check('the on-demand join gets a followed person’s room read', join.status === 200, join.text);
  check('alice now reads them too', (await readable(alice, other.room)).ok);
  const outsider = await call(A.app, undefined, 'POST', '/api/public/peers/join', { openid_token: openid, user_id: '@x:elsewhere.test', room_id: other.room });
  check('the on-demand join refuses someone on a server that isn’t a peer', outsider.status === 400 || outsider.status === 403, outsider.text);

  console.log('Stories');
  // As the app posts one (apps/web/src/matrix/stories.ts): the story type gated to the owner, then
  // an xyz.nekous.story with a picture. Both of B's profiles are readable on A by now.
  const levels = await as(bob)('GET', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/state/m.room.power_levels/`);
  const gate = await as(bob)('PUT', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/state/m.room.power_levels/`, {
    ...levels.json,
    events: { ...(levels.json?.events ?? {}), [STORY]: 100 },
  });
  check('bob gates stories to himself', gate.ok, gate.text);
  const storyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const storyUpload = await fetch(`${bob.hs}/_matrix/media/v3/upload?filename=story.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bob.token}`, 'Content-Type': 'image/png' },
    body: storyPng,
  }).then((res) => res.json());
  const storyContent = {
    body: 'a story from B',
    'xyz.nekous.attachments': [{ kind: 'image', url: storyUpload.content_uri, name: 'story.png', info: { mimetype: 'image/png', size: storyPng.length, w: 1, h: 1 } }],
  };
  const story = await as(bob)('PUT', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/send/${STORY}/st${Date.now()}`, storyContent);
  check('bob posts a story on B', story.ok, story.text);
  // What the app asks: the newest story events, filtered server-side.
  const storiesOnA = () =>
    as(alice)('GET', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/messages?dir=b&limit=50&filter=${enc(JSON.stringify({ types: [STORY] }))}`);
  const seenOnA = await until('bob’s story to reach A', async () => {
    const res = await storiesOnA();
    return (res.json?.chunk ?? []).find((event) => event.event_id === story.json?.event_id);
  });
  check('alice reads bob’s story on A, from bob, with its picture', seenOnA?.sender === bob.userId && seenOnA?.content?.body === 'a story from B' && seenOnA?.content?.['xyz.nekous.attachments']?.[0]?.url === storyUpload.content_uri, JSON.stringify(seenOnA).slice(0, 200));
  const [mediaServer, mediaId] = String(storyUpload.content_uri).replace('mxc://', '').split('/');
  const media = await fetch(`${alice.hs}/_matrix/client/v1/media/download/${mediaServer}/${mediaId}`, { headers: { Authorization: `Bearer ${alice.token}` } });
  check('and its picture, through A', media.ok && Buffer.from(await media.arrayBuffer()).equals(storyPng), String(media.status));
  await as(alice)('POST', `/_matrix/client/v3/join/${enc(bobProfile.roomId)}?server_name=${B.server}`, {});
  const forged = await as(alice)('PUT', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/send/${STORY}/f${Date.now()}`, { body: 'not bob' });
  check('alice can’t post a story in bob’s room', !forged.ok, `${forged.status}`);
  const removed = await as(bob)('PUT', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/redact/${enc(story.json?.event_id)}/r${Date.now()}`, { reason: 'Story expired' });
  check('bob deletes it', removed.ok, removed.text);
  const goneOnA = await until('the deletion to reach A', async () => {
    const res = await storiesOnA();
    const event = (res.json?.chunk ?? []).find((item) => item.event_id === story.json?.event_id);
    return event && !event.content?.body ? event : undefined;
  });
  check('and it’s gone on A too', !!goneOnA);

  console.log('Emotes and stickers');
  // Someone from A slips into B's library (its join rule is public) and writes a pack of their own.
  const intruderJoin = await as(alice)('POST', `/_matrix/client/v3/join/${enc(library)}?server_name=${B.server}`, {});
  const intruderPack = intruderJoin.ok
    ? await as(alice)('PUT', `/_matrix/client/v3/rooms/${enc(library)}/state/im.ponies.room_emotes/${enc(alice.userId)}`, {
        images: { evil: { url: 'mxc://hsa.test/evil', 'xyz.nekous.added_at': 0 } },
      })
    : intruderJoin;
  console.log(`      (alice's pack in B's library: ${intruderPack.status})`);
  ctl(A.tokenService, 'POST', '/peers/sync');
  const emotes = await until('B’s emotes to reach A', async () => {
    const res = await call(A.app, undefined, 'POST', '/api/public/peers/emotes', { openid_token: openid });
    return res.json?.peers?.[0]?.images?.length ? res : undefined;
  });
  const images = emotes?.json?.peers?.[0]?.images ?? [];
  check('A’s people get B’s library, named after B', emotes?.json?.peers?.[0]?.serverName === B.server, emotes?.text.slice(0, 200));
  check('with bob’s emote and sticker', images.some((i) => i.shortcode === 'wave' && i.emoticon) && images.some((i) => i.shortcode === 'stamp' && i.sticker && i.body === 'A stamp'), JSON.stringify(images));
  check('and not a pack someone from another server wrote into it', !images.some((i) => i.shortcode === 'evil'));
  const noToken = await call(A.app, undefined, 'POST', '/api/public/peers/emotes', {});
  check('only for A’s own signed-in people', noToken.status === 401, noToken.text);
  const bobOpenid = (await as(bob)('POST', `/_matrix/client/v3/user/${enc(bob.userId)}/openid/request_token`, {})).json;
  const fromB = await call(A.app, undefined, 'POST', '/api/public/peers/emotes', { openid_token: bobOpenid });
  check('not for someone on another server', fromB.status === 403 || fromB.status === 401, fromB.text);

  console.log('A’s public web');
  const feed = await until('B’s people on A’s public feed', async () => {
    const res = await call(A.app, undefined, 'GET', '/api/public/feed');
    const authors = new Set((res.json?.posts ?? []).map((post) => post.author));
    return authors.has(bob.userId) && authors.has(carol.userId) ? res : undefined;
  });
  check('A’s public feed has B’s people’s Global posts', !!feed);
  check('and never a Space post', !(feed?.json?.posts ?? []).some((post) => post.body === 'posted in the Cat Cafe'));
  const page = await call(A.app, undefined, 'GET', `/api/public/pages/bob:${B.server}`);
  check('A shows bob’s page at /@bob:hsb.test', page.status === 200 && page.json?.userId === bob.userId, page.text.slice(0, 200));
  console.log('Custom pages and profiles');
  const pageOnA = async () => (await as(alice)('GET', `/_matrix/client/v3/rooms/${enc(bobProfile.roomId)}/state/xyz.nekous.profile_page/`)).json;
  const bioOnA = async () => (await as(alice)('GET', `/_matrix/client/v3/profile/${enc(bob.userId)}`)).json?.['xyz.nekous.bio'];
  check('alice sees bob’s page as he built it (its colours and blocks)', (await pageOnA())?.style?.colors?.accent === '#ff3366', JSON.stringify(await pageOnA()).slice(0, 120));
  check('and his bio', (await bioOnA()) === 'bob’s bio on B', String(await bioOnA()));
  const custom = await until('A’s public web to show bob’s page', async () => {
    const res = await call(A.app, undefined, 'GET', `/api/public/pages/bob:${B.server}`);
    return res.json?.page?.style?.colors?.accent === '#ff3366' ? res : undefined;
  });
  check('A’s public web shows bob’s page and bio, signed out', !!custom && custom.json.bio === 'bob’s bio on B', custom?.text.slice(0, 160));
  await customise(bob, bobProfile.roomId, { accent: '#33cc99', bio: 'bob changed his bio', text: 'A new look' });
  const changed = await until('bob’s page change to reach A', async () => ((await pageOnA())?.style?.colors?.accent === '#33cc99' ? true : undefined), { timeout: 30_000, every: 2000 });
  check('a change to bob’s page reaches A within seconds', !!changed);
  const bioChanged = await until('bob’s bio change to reach A', async () => ((await bioOnA()) === 'bob changed his bio' ? true : undefined), { timeout: 60_000, every: 3000 });
  check('a change to his bio reaches A', !!bioChanged, String(await bioOnA()));
  const card = await call(A.app, undefined, 'GET', `/api/public/card/bob:${B.server}`);
  check('its link preview points at /@bob:hsb.test', card.text.includes(`/@bob:${B.server}`));

  const hereHide = ctl(A.tokenService, 'POST', `/pages/@carol:${B.server}/hide`, { reason: 'scenario' });
  check('A’s admin can hide a peer’s person', hereHide.status === 200, hereHide.text.trim());
  const carolPage = await call(A.app, undefined, 'GET', `/api/public/pages/carol:${B.server}`);
  check('and her page is gone from A at once', carolPage.status === 404);

  const homeHide = ctl(B.tokenService, 'POST', '/pages/bob/hide', { reason: 'scenario' });
  check('B’s admin hides bob on B', homeHide.status === 200, homeHide.text.trim());
  const gone = await until('A to follow B’s hide (a feed refresh, up to a minute)', async () => {
    const res = await call(A.app, undefined, 'GET', `/api/public/pages/bob:${B.server}`);
    return res.status === 404 ? res : undefined;
  }, { timeout: 120_000, every: 5000 });
  check('A stops showing bob once B hides him', !!gone);

  console.log('Removing the peer');
  const remove = ctl(A.tokenService, 'POST', `/peers/remove/${B.server}`, { reason: 'scenario' });
  check('A removes B', remove.status === 200, remove.text.trim());
  // The bot has left, so nothing new arrives; what A's homeserver stored stays readable to its
  // people (the app stops showing them: only approved peers' people are shown).
  const peersAfter = await call(A.app, undefined, 'GET', '/api/public/peers');
  check('A no longer lists B for its app', Array.isArray(peersAfter.json?.peers) && peersAfter.json.peers.length === 0, peersAfter.text);
  const newer = await as(bob)('PUT', `/_matrix/client/v3/rooms/${enc(cafe.feedId)}/send/xyz.nekous.post/late${Date.now()}`, { body: 'after the defederation' });
  await sleep(5000);
  check('nothing new from B reaches A after removal', newer.ok && !(await readable(alice, cafe.feedId)).posts.includes('after the defederation'));
  const after = await call(A.app, undefined, 'GET', `/api/public/pages/carol:${B.server}`);
  check('nobody on B has a page on A any more', after.status === 404);
  const emotesAfter = await call(A.app, undefined, 'POST', '/api/public/peers/emotes', { openid_token: openid });
  check('and B’s emotes are gone from A', emotesAfter.ok && Array.isArray(emotesAfter.json?.peers) && emotesAfter.json.peers.length === 0, emotesAfter.text);
  const audit = ctl(A.tokenService, 'GET', '/audit');
  check('A’s audit log has the peering', /peers\.add/.test(audit.text) && /peers\.remove/.test(audit.text));
}

main()
  .catch((err) => {
    console.error(err);
    results.push({ name: 'the scenario ran to the end', ok: false });
  })
  .finally(() => {
    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} passed.`);
    process.exit(failed.length ? 1 : 0);
  });
