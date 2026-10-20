# Purrlor API reference

Everything Purrlor exposes or defines beyond a stock Matrix client: the HTTP APIs of its two
services, the web client's runtime config, and the Matrix protocol extensions (custom events,
state, account data, push rules) that other clients and servers will see. It's written for people
reviewing the design and for anyone building something that talks to a Purrlor deployment.

**Status: draft for review.** Everything here describes the code as it is today; section 6 lists
what was raised in review and what was done about it.

**About the `xyz.nekous` namespace.** Purrlor was called NekoUs until it was renamed. Every custom
identifier keeps the `xyz.nekous.` prefix on purpose: they're stored in rooms and account data on
live servers, and renaming them would orphan that data. Treat the prefix as permanent.

**Contents**

1. [Components](#1-components)
2. [Token server HTTP API](#2-token-server-http-api)
3. [Push gateway HTTP API](#3-push-gateway-http-api)
4. [Web client runtime config](#4-web-client-runtime-config)
5. [Matrix protocol extensions](#5-matrix-protocol-extensions)
6. [Review notes and open questions](#6-review-notes-and-open-questions)
7. [Configuration](#7-configuration)

---

## 1. Components

| Component | What it is | Public URL (typical) | Talks to |
|---|---|---|---|
| Web client (`apps/web`) | The Purrlor app, a static SPA | `https://app.DOMAIN` | The user's homeserver; the token server; the push gateway |
| Token server (`services/token-server`) | Issues LiveKit tokens to Matrix users who are members of a voice channel | `https://token.DOMAIN` | LiveKit; the homeserver (as a bot account); users' homeservers (OpenID checks) |
| Push gateway (`services/push-gateway`) | Bridges the Matrix Push Gateway API to browser Web Push | `https://push.DOMAIN` | Browser push services (FCM, Mozilla, Apple) |
| LiveKit | Stock media server for voice/video | `wss://livekit.DOMAIN` | Clients (WebRTC) |
| Homeserver (optional, bundled) | Continuwuity, provisioned by `deploy/setup.sh` | `https://matrix.DOMAIN` | Other homeservers (federation) |

Everything is fronted by nginx for TLS; the services themselves listen on `127.0.0.1` (see
[`deployment.md`](deployment.md)). Voice and push URLs are **not** baked into the client: a Space
stores its voice server in room state and each account stores its push gateway in account data
(section 5), so one client build can use any number of deployments.

---

## 2. Token server HTTP API

Base URL: the token server's public origin, e.g. `https://token.DOMAIN`. All request and response
bodies are JSON. The voice routes (`/api/livekit/…`) answer any page: a Space's members on other
Matrix servers call them from their own server's app, and every request proves who's asking with an
OpenID token, so the page it comes from adds nothing (`corsPolicy.ts`). Everything else is limited to
`ALLOWED_ORIGINS` (comma-separated; one leading `*.` wildcard per entry allowed).

A Space's configured **token endpoint** is the full URL of `POST /api/livekit/token`; the client
derives the other two endpoints from its origin.

### `GET /health`

```json
200 { "status": "ok", "service": "purrlor-token-server" }
```

### `GET /api/livekit/config`

Unauthenticated. Tells clients which Matrix account the token server's membership bot uses, so
the client can invite it into voice channels itself.

```json
200 { "botUserId": "@purrlor-voice-bot:example.org" }
503 { "error": "Service bot is not available" }
```

### `POST /api/livekit/token`

Exchanges proof of Matrix identity for a LiveKit access token scoped to one voice channel.

Request:

```json
{
  "openid_token": {
    "access_token": "…",
    "token_type": "Bearer",
    "matrix_server_name": "example.org",
    "expires_in": 3600
  },
  "room_id": "!voiceChannel:example.org"
}
```

`openid_token` is the object returned by the client-server API
`POST /_matrix/client/v3/user/{userId}/openid/request_token`.

How it's checked, in order:

1. **Identity.** The OpenID token is validated against the user's own homeserver
   (`GET /_matrix/federation/v1/openid/userinfo`), found through the spec's server-name
   resolution: `.well-known/matrix/server`, then SRV records, then port 8448. This works for users
   on any federated server.
2. **Tenancy.** The room must be a voice channel in a Space this deployment serves: created on
   the bot's own homeserver (section 5.10 — never read off the room ID), and in
   `VOICE_ALLOWED_SPACES` when that's set.
3. **Membership.** The bot reads the room's member list and power levels (never message content)
   and requires the user to be joined.

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "token": "<JWT>", "roomName": "matrix-…" }` | Success. Token lifetime 24h. |
| 400 | `{ "error": "openid_token and room_id are required" }` | Malformed request. |
| 401 | `{ "error": "Authentication failed" }` | OpenID token invalid or unverifiable. |
| 403 | `{ "error": "…", "code": "not_a_member" }` | Caller isn't joined to the room. |
| 403 | `{ "error": "…", "code": "room_not_served" }` | Room isn't a voice channel in a served Space. |
| 409 | `{ "error": "…", "code": "voice_bot_not_in_room", "botUserId": "@…" }` | The bot hasn't been invited yet. The client invites it and retries. |

The LiveKit token's identity and name are the Matrix user ID. Grants: `roomJoin`, `canPublish`,
`canSubscribe`, `canPublishData`, `canUpdateOwnMetadata`, plus `roomAdmin` when the user's power
level in the room is at least `VOICE_MODERATOR_POWER_LEVEL` (default 50).

**LiveKit room name.** `matrix-` + unpadded base64url of the Matrix room ID's UTF-8 bytes. The
client computes the same name (`apps/web/src/matrix/voice.ts`); the two copies must stay
identical.

### `POST /api/livekit/rooms/participants`

Who's currently in one or more voice channels, read live from LiveKit — **only for channels the
caller is a joined member of**.

```json
{ "openid_token": { "access_token": "…", "matrix_server_name": "example.org", "expires_in": 3600 },
  "room_ids": ["!a:x", "!b:x"] }
```

```json
200 {
  "!a:x": [ { "identity": "@alice:x", "micMuted": false, "deafened": false } ],
  "!b:x": []
}
```

- Rooms the caller may not see are **left out** of the response, so it never confirms whether a
  made-up room ID exists. An empty channel is an empty list.
- At most 50 room IDs per request.
- `400` without `openid_token` or `room_ids`; `401` for a token that doesn't validate.
- The channel list polls this every few seconds, so successful OpenID validations are cached for
  up to 5 minutes (never past the token's own `expires_in`), keyed on a hash of the token and its
  server. The client reuses one OpenID token until a minute before it expires.

The former `GET /api/livekit/rooms/participants?roomIds=…` now answers `401` with
`"code": "auth_required"`.

### `POST /api/webhooks/{roomId}/{webhookId}/{token}`

An incoming webhook: posts `{ "content": "…", "username"?: "…" }` (Discord's shape) or
`{ "text": "…" }` (Slack's) into the channel as the service bot, under the webhook's name. The token
is the credential; the channel stores only its SHA-256 (`xyz.nekous.webhook` state). `204` posted,
`400` bad body, `404` unknown webhook or wrong token, `409` encrypted channel, `429` rate limited.
See [webhooks.md](webhooks.md).

### `GET`/`POST /api/public/bugs`

Bug reports sent with `!bug <project> <text>`. `GET` lists the projects (`BUG_PROJECTS`) and this
server's name; `POST` takes `{ openid_token, project, text, platform?, version?, space_id? }` from an
account on this server, or from another server's account in a Space served here (`space_id`), keeps
it and has the service bot post it to the admins' room. Open to any page, like voice. See
[bug-reports.md](bug-reports.md).

### `GET /api/public/…`

The public web, for people who aren't signed in: Global posts and opted-in profile pages, their
media, and link-preview cards. `pages/{user}`, `feed`, `posts/{eventId}`, `status/{user}`,
`media/{server}/{mediaId}`, `card/{user}`, `card/post/{eventId}`. All read-only, no sign-in, rate
limited per address. See [public-web.md](public-web.md) for the shapes and the rules.

---

## 3. Push gateway HTTP API

Base URL: e.g. `https://push.DOMAIN`. CORS as for the token server.

### `GET /health`

```json
200 { "status": "ok", "service": "purrlor-push-gateway" }
```

### `GET /vapid-public-key`

```json
200 { "publicKey": "B…" }
```

Served at runtime so rotating the VAPID pair needs no client rebuild. Rotating it invalidates
every existing browser subscription.

### `POST /subscribe`

Stores (or refreshes) a browser's Web Push subscription under a pushkey the client generated, for
the Matrix account proven by `openid_token` (validated exactly as the token server does — the
gateway's `openid.ts` is a copy, and a test fails if the two ever differ).

```json
{ "openid_token": { "access_token": "…", "matrix_server_name": "example.org", "expires_in": 3600 },
  "pushkey": "<random, client-generated>",
  "subscription": { "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" } } }
```

| Status | Meaning |
|---|---|
| 204 | Saved for this account. |
| 400 | `pushkey` or `subscription` missing. |
| 401 `auth_required` | No valid `openid_token`. |
| 403 `pushkey_taken` | The pushkey is registered to another account. It stays theirs, so knowing someone's pushkey isn't enough to redirect their notifications. |

The web client re-registers its existing subscription on every start, which refills the gateway's
in-memory store after a restart or redeploy and keeps pushers current. A pushkey is per browser; on
a shared browser, turning push on for a second account takes a fresh pushkey.

### `DELETE /subscribe/{pushkey}`

Forgets a subscription — only for the account that registered it. Body:
`{ "openid_token": { … } }`. `401` without a valid token; otherwise `204` whether or not
anything was removed, so it confirms nothing about pushkeys the caller doesn't own.

### `POST /_matrix/push/v1/notify`

The standard [Matrix Push Gateway API](https://spec.matrix.org/latest/push-gateway-api/), called
by the homeserver. For each device it sends one Web Push message and replies with
`{ "rejected": [pushkeys] }`: pushkeys whose subscription is unknown, or which the push service
reports gone (404/410), so the homeserver drops those pushers.

The spec gives this endpoint no authentication — a homeserver calls it with no credentials, and an
unguessable pushkey is what protects it. As a second check, a device whose pusher data names its
account (`data.user_id`, section 5.7) is delivered to only if that matches the subscription's
owner.

The Web Push payload delivered to the service worker (`apps/web/public/sw.js`):

```json
{ "title": "Alice", "body": "…", "roomId": "!…", "eventId": "$…", "unreadCount": 3 }
```

How `body` is worded:

| Event | Body |
|---|---|
| `xyz.nekous.comment` that replies to the recipient | `Replied to your comment: <text>` |
| any other `xyz.nekous.comment` | `Commented on your post: <text>` |
| `m.reaction` | `Liked your post` |
| anything else | `<room name>: <body>`, or `Sent a message` when there's no plaintext (encrypted rooms) |

"Replies to the recipient" is decided with the pusher's `data.user_id` (section 5.7). Pushers
registered before that field existed fall back to the `highlight` tweak, which only the mention
rule sets.

---

## 4. Web client runtime config

### `GET /config.json` (served by the web container)

```json
{ "homeserver": "https://matrix.example.org" }
```

Written at container start from `PURRLOR_HOMESERVER_URL`. A non-empty `homeserver` locks the
login and register screens to that homeserver. Empty or missing means the client asks which
homeserver to use. Served with `Cache-Control: no-store`.

---

## 5. Matrix protocol extensions

Purrlor uses the standard Matrix client-server API throughout. What it adds are the custom types
below. Unknown types are ignored by other clients, so none of this breaks Element or anything
else. It just isn't shown there.

### 5.1 Room state events

| Type | State key | In | Content | Written by |
|---|---|---|---|---|
| `xyz.nekous.channel_type` | `""` | A channel | `{ "type": "text" \| "voice" \| "feed" }` (absent = text) | Channel creator |
| `xyz.nekous.voice_server` | `""` | A Space | `{ "url": "wss://…", "tokenEndpoint": "https://…/api/livekit/token", "botUserId": "@…" }` (`botUserId` optional) | Space admins |
| `xyz.nekous.channel_categories` | `""` | A Space | `{ "categories": [ { "id": "…", "name": "…", "channelIds": ["!…"] } ] }` | Space admins |
| `xyz.nekous.feed` | `""` | A feed room | `{ "owner": "@…", "spaceId": "!…" }`, or `{ "owner": "@…", "profile": true }` for a profile feed | Feed owner, at creation |
| `im.ponies.room_emotes` | `"@user:server"` | The emote library | A standard MSC2545 pack: that person's own global emotes and stickers. Each image may carry `xyz.nekous.added_at` (ms), which decides who keeps a shortcode two people chose. Packs under any other state key are ignored, and so are packs by people on other servers (the room's join rule is public, so they can join). | That person only (Matrix rejects an `@`-prefixed state key that isn't the sender's own ID) |
| `xyz.nekous.emote_moderation` | `""` | The emote library | `{ "hidden": ["mxc://…"] }`: images every Purrlor client leaves out | Library moderators |
| `xyz.nekous.webhook` | the webhook's id | A channel | `{ "name", "token_sha256", "avatar_url"? }`; `{}` once deleted. See [webhooks.md](webhooks.md). | Channel moderators |
| `xyz.nekous.calendar_event` | the event's id | A Space | `{ "title", "description"?, "start", "end"?, "channel_id"?, "location"? }` (times in UTC ms); `{}` when cancelled. See [calendar.md](calendar.md). | Space moderators |
| `xyz.nekous.moderation` | `""` | A Space | `{ "review_room": "!…", "blocked_words": ["…"] }`: report review and automod. See [moderation.md](moderation.md). | Space moderators |
| `xyz.nekous.profile_page` | `""` | A profile room | A profile page: `{ "version": 1, "style": { … }, "blocks": [ … ] }`; `{}` when taken down. See [profile-pages.md](profile-pages.md). | The profile's owner |
| `xyz.nekous.public_web` | `""` | A profile room | `{ "enabled": true }`: the page may be shown to people who aren't signed in. Anything else is off. See [public-web.md](public-web.md). | The profile's owner |
| `xyz.nekous.channel_settings` | `""` | A channel | `{ "moderators_only": true, "slowmode_seconds": 30 }`, both optional. Moderators-only also means the room is invite-only; slowmode is honoured by Purrlor's composer only. See [channel-permissions.md](channel-permissions.md). | Channel moderators |

A sub-space inherits its parent's `xyz.nekous.voice_server` unless it sets its own. See
[`voice-architecture.md`](voice-architecture.md).

**Custom keys inside standard state events:**

| Event | Key | Value | Why |
|---|---|---|---|
| `m.space.child` (in a Space) | `xyz.nekous.channel_type` | Same as the channel's own type | Lets the voice bot find voice channels without joining text channels |
| `m.room.member` (your own, in a Space) | `xyz.nekous.rsvps` | `{ "<calendar event id>": "going" \| "interested" }` | RSVPs, which only you can write. See [`calendar.md`](calendar.md). |
| `m.room.member` (your own, in a Space) | `xyz.nekous.feed_room` | Your feed room's ID | Feed discovery. It's the one piece of Space state every member can write for themselves and everyone can read. See [`posts.md`](posts.md). |

### 5.2 Room types

| `creation_content.type` | Meaning |
|---|---|
| `m.space` | Standard Space |
| `xyz.nekous.profile` | A person's global profile feed. Listed in the room directory (so the global feed can find it), `world_readable`, public join. Discover hides it. |
| `xyz.nekous.emote_library` | The server's **global emote library**, one per homeserver, at the alias `#purrlor-emotes:<server>` (a client only trusts a room with both this type and that canonical alias). Every Purrlor client joins it in the background and hides it from room lists. |

**Setting up the emote library.** `purrlor emotes setup` creates it as the admin (the installer
runs that for you). By hand, with any client that can send a raw `createRoom`, as the account that
should own it:

```json
{
  "name": "Emote library",
  "room_alias_name": "purrlor-emotes",
  "visibility": "private",
  "creation_content": { "type": "xyz.nekous.emote_library" },
  "power_level_content_override": {
    "users_default": 0, "events_default": 50, "state_default": 50,
    "invite": 50, "kick": 50, "ban": 50, "redact": 50,
    "events": { "im.ponies.room_emotes": 0, "xyz.nekous.emote_moderation": 50, "m.room.power_levels": 50 }
  },
  "initial_state": [
    { "type": "m.room.join_rules", "state_key": "", "content": { "join_rule": "public" } },
    { "type": "m.room.history_visibility", "state_key": "", "content": { "history_visibility": "shared" } },
    { "type": "m.room.guest_access", "state_key": "", "content": { "guest_access": "forbidden" } }
  ]
}
```

Level 0 lets everyone keep a pack; 50 makes a moderator, who can hide an image
(`xyz.nekous.emote_moderation`), take down someone's whole pack (redacting their pack event), and
mute someone (power level -1, below what a pack needs). Moderators can appoint other moderators
from the app.

### 5.3 Timeline events

**`xyz.nekous.story`**: a story, in the owner's profile feed only, with a post's content (text and
at most one item under `xyz.nekous.attachments`). Readers show it for 24 hours from
`origin_server_ts`, only if sent by the room's owner; the owner's client redacts it after that. See
`docs/stories.md`.

**`xyz.nekous.post`**: a post, sent only by the feed's owner (power level 100 for this type). In a
Space feed, the owner's client also keeps the Space's moderators at power level 50 (redact, kick)
and every state event at 100; see `docs/posts.md`, "The Space's authority over feeds".

```json
{
  "body": "finally got **voice** working",
  "format": "org.matrix.custom.html",
  "formatted_body": "finally got <strong>voice</strong> working",
  "xyz.nekous.attachments": [
    { "kind": "image", "url": "mxc://…", "name": "cat.webp", "info": { "mimetype": "image/webp", "size": 48213, "w": 1280, "h": 960 } }
  ],
  "xyz.nekous.repost_of": {
    "roomId": "!…", "eventId": "$…", "sender": "@…", "senderName": "Bob",
    "origin": { "kind": "space", "spaceId": "!…", "spaceName": "Cats" },
    "ts": 1790000000000, "body": "…", "attachments": [ ]
  }
}
```

- Every field except `body` is optional. A post needs text, media, or a repost.
- **Attachments** (up to 4): `kind` is `image` or `video`. An item has either a plain `url`, for
  posts in public places, or an encrypted `file` block in the same format as `m.room.encrypted`
  attachments (`url`, `key`, `iv`, `hashes`), for everywhere else, with the key inside the post.
  Accepted types are JPEG, PNG, GIF, WebP, WebM and MP4; JPEG and PNG are re-encoded to WebP
  before upload.
- **Reposts** embed the original whole. `origin` is `{ "kind": "global" }` or a Space. Readers
  check the copy against the original (`GET /rooms/{roomId}/event/{eventId}`, plus its edits) and
  don't show one that doesn't match or whose original is gone.
- **Edits** are an `xyz.nekous.post` with `m.relates_to: { "rel_type": "m.replace", "event_id": … }`
  and the whole new content under `m.new_content`. Only an edit by the post's own sender counts.
- **Mentions** are `m.mentions.user_ids`, on posts and comments alike. For a Global post, each
  mentioned person not already in the author's profile room is also invited to it, with the
  invite `reason` `Mentioned you in a post (xyz.nekous.mention <post event ID>)`. Purrlor accepts
  such an invite by itself when it's to an `xyz.nekous.profile` room from that room's creator.

**`xyz.nekous.comment`**: a comment on a post, in the post's feed room. Anyone joined can send it.

```json
{
  "body": "agreed",
  "xyz.nekous.attachments": [ ],
  "xyz.nekous.reply_to": { "event_id": "$otherComment", "sender": "@bob:example.org" },
  "m.mentions": { "user_ids": ["@bob:example.org"] },
  "m.relates_to": { "rel_type": "m.reference", "event_id": "$post" }
}
```

- Same text and media shape as a post.
- `xyz.nekous.reply_to` and `m.mentions` appear only on a reply to another comment. The mention
  is what notifies the person replied to, through the spec's `.m.rule.is_user_mention`. It's
  omitted when you reply to yourself.

**Likes** are standard `m.reaction` events on the post:

```json
{ "m.relates_to": { "rel_type": "m.annotation", "event_id": "$post", "key": "❤️" } }
```

Un-liking redacts the reaction. One like is counted per person.

### 5.4 Account data (per user, private)

| Type | Content |
|---|---|
| `xyz.nekous.feed_rooms` | `{ "<spaceId>": "<feedRoomId>" }`. Your feed in each Space. |
| `xyz.nekous.profile_room` | `{ "roomId": "!…" }`. Your profile feed. |
| `xyz.nekous.private_posts` | `{ "items": [ { "id", "spaceId", "body", "createdAt", "attachments"? } ] }`. "Only me" posts; never in any room. |
| `xyz.nekous.follows` | `{ "users": ["@…"], "spaces": ["!…"] }`. Never shown to anyone else. |
| `xyz.nekous.stories_seen` | `{ "seen": { "<eventId>": <story ts> } }`. Stories you've watched; entries drop out after 24 hours. |
| `xyz.nekous.post_notifications` | `{ "comments": true, "likes": true }`. Both default to on. |
| `xyz.nekous.notification_settings` | `{ "spaces": { "<spaceId>": "<level>" }, "rooms": { "<roomId>": "<level>" } }`, level `all`, `mentions` or `nothing`. A room's own level beats its Space's. See [notification-settings.md](notification-settings.md). |
| `xyz.nekous.push_gateway` | `{ "url": "https://push.DOMAIN" }` |
| `xyz.nekous.reminders` | `{ "items": [ { "id", "roomId", "eventId", "remindAt", "preview" } ] }`. Message reminders; removed once shown. |
| `xyz.nekous.saved_messages` | `{ "items": [ { "roomId", "eventId", "savedAt" } ] }` |
| `xyz.nekous.mention_inbox` | `{ "items": [ { "roomId", "eventId", "mentionedAt" } ] }` |
| `xyz.nekous.space_nicknames` | `{ "<spaceId>": "<nickname>" }` |
| `xyz.nekous.left_channels` | `{ "roomIds": ["!…"] }`. Channels you left, so auto-join never re-adds you. |
| `xyz.nekous.profile_page_draft` | `{ "page": { … }, "updated_ts": … }`. Your profile page's unpublished draft. See [profile-pages.md](profile-pages.md). |

### 5.5 Extended profile fields (MSC4133)

Written one key at a time through matrix-js-sdk's `setExtendedProfileProperty` (the MSC4133
per-field `PUT …/profile/{userId}/{key}`, on whichever stable or unstable path the server
advertises). Public to anyone who can look up the profile.

| Key | Value |
|---|---|
| `xyz.nekous.bio` | Free text |
| `xyz.nekous.banner_url` | `mxc://…` |
| `xyz.nekous.avatar_animated` | `true` when the avatar is an animated GIF/WebP (so clients don't thumbnail it) |
| `xyz.nekous.profile_room` | Your profile feed's room ID, so a profile page can find your posts from a user ID |
| `xyz.nekous.typing_verb` | Your word for "typing" in the typing indicator: `"yelling"` shows "Alice is yelling…". Plain text, one line, up to 24 characters; clients clean it on write *and* read (no line breaks, control or bidi characters, leading "is", trailing dots). Unset or `"typing"` means the default. |

On a server without MSC4133 these are simply absent. Everything degrades gracefully.

### 5.6 Push rules (per user)

Purrlor keeps two **override** rules per feed room you own, in step with
`xyz.nekous.post_notifications`:

```json
PUT /_matrix/client/v3/pushrules/global/override/xyz.nekous.feed_comment.<roomId>
{ "conditions": [ { "kind": "event_match", "key": "type", "pattern": "xyz.nekous.comment" },
                  { "kind": "event_match", "key": "room_id", "pattern": "<roomId>" } ],
  "actions": [ "notify", { "set_tweak": "sound", "value": "default" } ] }

PUT /_matrix/client/v3/pushrules/global/override/xyz.nekous.feed_like.<roomId>
{ "conditions": [ { "kind": "event_match", "key": "type", "pattern": "m.reaction" },
                  { "kind": "event_match", "key": "room_id", "pattern": "<roomId>" } ],
  "actions": [ "notify" ] }
```

User rules outrank the server default `.m.rule.reaction`, which otherwise mutes reactions. Reply
notifications need no custom rule; they use the built-in mention rule (5.3).

For `xyz.nekous.notification_settings`, each room at "Only @mentions" or "Nothing" (its own level,
or its Space's) gets one rule named after the room, the same rules Element and Cinny write for
their per-room settings. "All messages" means neither rule.

```json
// Only @mentions: plain messages stop here; mention rules are overrides, so they run first
PUT /_matrix/client/v3/pushrules/global/room/<roomId>
{ "actions": [] }

// Nothing: runs before the mention rules too
PUT /_matrix/client/v3/pushrules/global/override/<roomId>
{ "conditions": [ { "kind": "event_match", "key": "room_id", "pattern": "<roomId>" } ],
  "actions": [] }
```

### 5.7 Pusher

Registered with `POST /_matrix/client/v3/pushers/set`:

```json
{ "app_id": "xyz.nekous.webpush", "kind": "http", "pushkey": "<random>",
  "data": { "url": "https://push.DOMAIN/_matrix/push/v1/notify", "user_id": "@you:example.org" } }
```

`data.user_id` comes back to the gateway with every notification (the spec echoes pusher data),
which is how it words replies correctly and checks the subscription's owner (section 3). The client
re-sets its pusher on every start, so older pushers pick `user_id` up without anyone re-enabling
push.

### 5.8 LiveKit data channel

Watch Together and Listen Together send small control messages on topic `xyz.nekous.watch_together`:

```json
{ "type": "state", "state": { "kind": "youtube" | "media", "mode": "watch" | "listen", "url": "…", "videoId": "…", "playing": true, "positionSeconds": 12.5, "updatedAt": 1790000000000, "startedBy": "@alice:example.org" } }
{ "type": "stop" }
{ "type": "request-sync" }
```

`videoId` is set only for YouTube. `mode` is `"watch"` (the call's video area) or `"listen"` (the Now
playing card, which keeps playing whichever channel is open); a state with no `mode` came from an
older client and means watch. A direct audio file is always `"listen"`. A participant sends
`request-sync` once connected (and again after a reconnect), and anyone who knows the current state
answers with it. Every participant plays the media itself; only these
messages cross LiveKit.

### 5.9 Standard features relied on

`m.space.child` / `m.space.parent` (Spaces and channel order), restricted join rules (Space-scoped
feeds and channels), `m.reaction`, `m.reference` relations, `m.mentions`, MSC2545 image packs
(custom emotes, interoperable with Element/Cinny/FluffyChat), the room directory, and
`/relations`, `/context` and `/messages` for reading threads.

### 5.10 Room versions and where a room was created

From room version 12 on (what Continuwuity creates), a room ID is a bare hash with no `:server`
part. Purrlor never reads a server name off a room ID. **Where a room was created** is the server of
its `m.room.create` sender, which works in every room version and is known for any room you've
joined or been invited to; the room ID's server is used only as a fallback where it still has one.
This decides the token server's "local rooms only" gate (a v12 room it hasn't seen yet is decided by
its Space's claim, and the bot leaves at once if it turns out to be from elsewhere) and the client's
matching check. **Joins** go through servers known to be in the room: the feed owner's for a feed,
the Space's creator and your own for a channel.

### 5.11 Privacy model, in one paragraph

Matrix has no per-event visibility, so Purrlor never marks an event "private". Privacy comes from
**where** something lives: a public post is in a `world_readable` feed room; a private-Space post
is in a feed room only that Space's members can join (restricted join rule, `shared` history); an
"Only me" post is in account data and never in a room. Media follows the same line: plain uploads
only where the content is public, and browser-side encryption with the key inside the event
everywhere else, because an `mxc://` URL is fetchable by anyone who has it. A Space counts as
public only when it's **listed in the room directory**. A public join link alone doesn't make it
public. See [`posts.md`](posts.md).

---

## 6. Review notes and open questions

What was raised in review, and what was done:

- **Fixed — voice participants were readable by anyone.** `GET /api/livekit/rooms/participants`
  took no authentication, so anyone who knew a voice channel's room ID could see who was in the
  call. It's now `POST` with a Matrix OpenID token, and answers only for channels the caller is a
  member of (section 2).
- **Fixed — push subscriptions could be taken over or removed.** `/subscribe` and
  `DELETE /subscribe/{pushkey}` took no authentication; a leaked pushkey let someone redirect that
  person's notifications to their own browser or switch them off. Both now require a Matrix OpenID
  token, and a pushkey is bound to the account that registered it (section 3). A gateway restart
  also used to end background push for everyone until they re-enabled it; clients now re-register
  on start.
- **Fixed — room version 12 broke voice entirely.** Deciding "created on our server?" from the room
  ID refused every v12 voice channel and kept the bot out of every v12 Space — every room
  Continuwuity creates. It's now decided from the `m.room.create` sender, on both the token server
  and the client, and joins no longer derive a server from a room ID (section 5.10). All three fixes
  were checked end to end against a live Continuwuity, LiveKit, token server and push gateway.
- **By design — `GET /api/livekit/config` is public.** It returns only the bot's user ID, which is
  public as soon as the bot is in any room.
- **By design — reading without joining.** The global feed reads public feeds (`/messages`,
  `/relations`, `/state`) as a non-member. That depends on rooms being `world_readable`, which
  Purrlor sets only for listed Spaces and profile feeds.
- **By design — `/_matrix/push/v1/notify` has no authentication.** That's the Matrix spec's
  design; see section 3 for the extra owner check.
- **Upstream — Continuwuity's `/relations` paginates backwards wrong.** In
  `src/api/client/relations.rs`, a backward page's `next_batch` is taken from `events.first()`
  (the newest event on the page) instead of `events.last()` (the oldest), so each page steps back
  one event. Still present on its `main` as of 2026-09-25. Purrlor reads only the first page there
  and uses `/context` + `/messages` for older relations, and ignores relations that don't point
  at the post itself (Continuwuity also returns relations-of-relations without `recurse`). To be
  reported on Continuwuity's issue tracker.
- **Decided — the `xyz.nekous` namespace.** It names the protocol, not a deployment: every
  Purrlor server, whatever domain it runs on, must use the same identifiers or their users can't
  read each other's posts, comments or voice config. Reverse-DNS naming is the Matrix convention for
  avoiding clashes with other apps, and it doesn't tie anyone to that domain. Registering an MSC is
  only needed if other clients (Element and the like) should adopt these types; it isn't needed for
  Purrlor deployments to interoperate with each other.

---

## 7. Configuration

All deployment configuration is environment variables in `.env`, documented line by line in
[`.env.example`](../.env.example): LiveKit keys, `HOST_IP`, `ALLOWED_ORIGINS`, the bot account,
`VOICE_MODERATOR_POWER_LEVEL`, `VOICE_ALLOWED_SPACES`, VAPID keys, `PURRLOR_HOMESERVER_URL`,
`OUTBOUND_PROXY` / `OUTBOUND_NO_PROXY`, and the bundled homeserver's `COMPOSE_PROFILES`,
`MATRIX_SERVER_NAME`, `MATRIX_REGISTRATION_TOKEN` and `MATRIX_ALLOW_REGISTRATION`. See
[`deployment.md`](deployment.md) for the guided installer that writes all of it.
