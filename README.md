# Purrlor

A from-scratch, Discord-shaped frontend for Matrix — Spaces as servers, rooms as channels, voice
channels backed by per-Space LiveKit servers with Matrix-membership-gated auth. Purrlor is a
**client only**; Matrix (Synapse, Continuwuity, or any spec-compliant homeserver) is the backend.

See [`docs/api.md`](docs/api.md) for the API reference (the services' HTTP APIs and every Matrix
extension Purrlor defines), [`docs/theming.md`](docs/theming.md) for the CSS theming contract,
[`docs/voice-architecture.md`](docs/voice-architecture.md) for how voice/video calls work under the
hood, [`docs/posts.md`](docs/posts.md) for posts, comments and the global feed,
[`docs/push-notifications.md`](docs/push-notifications.md) for background push,
[`docs/notification-settings.md`](docs/notification-settings.md) for per-channel and per-Space
notification levels, [`docs/channel-permissions.md`](docs/channel-permissions.md) for
announcement and moderators-only channels and slowmode, [`docs/roles.md`](docs/roles.md) for custom
roles and channel-only moderators, [`docs/moderation.md`](docs/moderation.md)
for report review and automod, [`docs/calendar.md`](docs/calendar.md) for Space calendars and
reminders, [`docs/webhooks.md`](docs/webhooks.md) for incoming webhooks,
[`docs/profile-pages.md`](docs/profile-pages.md) for profile pages and the page builder,
[`docs/public-web.md`](docs/public-web.md) for what signed-out visitors can see,
[`docs/federation.md`](docs/federation.md) for sharing the social side with other Purrlor instances,
[`docs/bug-reports.md`](docs/bug-reports.md) for `!bug` reports to the server's admins, and
[`docs/deployment.md`](docs/deployment.md) for a full self-hosting guide.

Purrlor was called NekoUs until it was renamed. Identifiers that live in stored data keep the old
name on purpose, because changing them would break existing deployments: the `xyz.nekous.*`
Matrix event and account-data types (voice config, channel types, posts, …), the `nekous_*`
browser-storage keys and IndexedDB names (renaming them would sign everyone out and drop their
local encryption keys), and the `nu-` CSS prefix that custom themes target. Don't "fix" them.

## Using Purrlor

### Desktop app (Windows)
Prefer an app to a browser tab? Install **Purrlor-Setup.exe** from the
[releases page](https://github.com/m0nnnna/Purrlor/releases). On first launch it asks which Purrlor
server to connect to (`purr.meowops.net` by default, or your own deployment); click the server
name in the title bar to switch later. It stays in the tray for notifications and can start with
Windows. See [`apps/desktop/README.md`](apps/desktop/README.md).

### Android app
Install **Purrlor.apk** from the [releases page](https://github.com/m0nnnna/Purrlor/releases). On
first launch it asks which Purrlor server to open (`purr.meowops.net` by default, or your own
deployment); long-press its icon for Change server. It opens the server full screen in the phone's
Chrome, with notifications, voice and sharing from other apps, as on the website. See [`apps/android/README.md`](apps/android/README.md).

### Signing in
Open the app and enter a **homeserver** (defaults to `matrix.org`, but works with any Matrix
homeserver — including a self-hosted one) plus a username/password to log in, or use "Register"
to create a new account on that homeserver. A deployment can lock the app to its own homeserver
(`PURRLOR_HOMESERVER_URL`, which the guided installer sets); the homeserver field is then replaced
by the server's name. On an invite-only server, "Register" asks for the registration token the
server's admin handed out; on one that signs people up by email, it asks to confirm an email
address instead. A brand-new session may show a recovery prompt to
unlock past encrypted history — enter the account's recovery key/passphrase, verify from another
already-signed-in device via emoji comparison, or skip it for now and unlock it later from Account
Settings.

Just want to look around first? Click **"Just looking? Take a tour with sample data"** on the login
screen (or add `?demo` to the URL) — see [Demo mode](#demo-mode).

### Layout
- **Server rail** (far left) — a column of Space icons, like Discord servers. The pinned icon at
  the top is Home (Direct Messages and any room not organized under a Space); below it are your
  joined Spaces, then Notifications, Invites, and Discover.
- **Channel list** — the selected Space's channels, grouped into categories, with voice channels
  shown separately from text channels. On the social side (the globe or the bell) it lists the
  social side's own places instead: Everyone, Following, Notifications, your profile, and each of
  your Spaces' Posts.
- **Main pane** — the selected channel's timeline (or a voice channel's call panel).
- **Member list** (far right, collapsible on mobile) — who's in the current channel/Space.
- Below ~900px wide, this collapses into one screen at a time instead of four columns side by side.

### Joining or creating a Space
- **Have an invite?** Click the ✉️ Invites icon in the server rail to accept or decline it.
- **Have an invite link?** Just open it — it joins you straight in (creating an account first if
  you don't have one yet).
- **Don't have either?** Click 🧭 Discover to search public Spaces and join with one click.
- **Starting your own?** Click the **+** at the bottom of the server rail to create a new Space,
  then use its channel list header's **+** to add channels to it.

Joining a Space joins you to all of its channels that don't need an invite, text and voice, and
new channels added later join you automatically too. Leave a channel and it stays left. For a
Space you were in before this, **Join all** under "More channels" does the same in one click.

To leave a Space, open its ⚙ settings → **Leave**. That takes you out of its channels too; rejoin
later and they come back, along with your posts.

### Messaging
Type in the composer and send with Enter (Shift+Enter for a newline). Supports Markdown
(`**bold**`, `*italic*`, `` `code` ``, `~~strikethrough~~`), `||spoilers||`, fenced code blocks
with syntax highlighting, `@mentions` (autocompleted), and slash commands (`/me`, `/nick`,
`/topic`, `/invite`, `/kick`, `/ban`, `/unban`, `/leave`, `/shrug`). Drag a file in or paste an
image to upload it. Hover a message for reactions, reply, edit, forward, pin, and save-for-later;
right-click (or the "..." menu) for more. The 🔍 icon searches the current channel or everywhere;
the 🔔 in the server rail opens Notifications, which includes everywhere you were actually
@mentioned, so you don't have to scroll back to find it.

Found a bug? Type `!bug <project> <what's wrong>` in any channel or DM, e.g.
`!bug purrlor emojis don't work on mobile`. It goes to the server's admins, not into the channel;
the word after `!bug` is the project it's filed under (an unknown one gets you the list). See
[`docs/bug-reports.md`](docs/bug-reports.md).

### Voice & video
Click a voice channel to join instantly — no separate "call" step. The call bar stays active even
if you switch to a different text channel, so you can keep chatting elsewhere without hanging up;
click it to jump back. Controls: mute/deafen, push-to-talk (hold a key instead of toggling —
click the key name next to it to rebind, default Right Ctrl), webcam, and screen share (with
audio, plus a pop-out window). Voice channels set themselves up: as long as the Space has a
voice server configured, a new voice channel is joinable the moment it exists, with no
per-channel setup step. The 📺 button starts
**Watch Together** — paste a YouTube or direct media link and everyone in the call watches in
sync; anyone can play/pause/seek and it's reflected for the whole call. The 🎵 button starts
**Listen Together** instead: music (a YouTube or YouTube Music link, or a direct audio file) plays
for everyone from a small **Now playing** card by the call bar, and keeps going while you chat in
other channels. Everyone sets their own volume, and deafening silences it too.

### Posts
Every Space has a **Posts** page (top of its channel list), and the globe under Home opens the
**global feed**: public posts from across the server, or just the people and Spaces you follow.
Post text, images or video to Global or any of your Spaces; keep a post to yourself with "Only me".
Under any post: **Like**, **Comment** (text, images and video, like a post), **Reply** to a
specific comment, and **Repost** (instantly, or **Quote** it with your own words). The **⋯** menu
has the rest: **Report**, **See who liked**, and on your own posts **Edit**, **Pin to profile** and
**Delete**. A Space's moderators can remove any post or comment in that Space. `@mention` people
and use `#tags`; a tag opens every post with it. A timeline shows a post's newest 3 comments; tap a
post's time or text for its own page with the whole thread. **Notifications** (the 🔔 on the
server rail, with a count of what's new) is one list of everything about you: who liked, commented
on, reposted or quoted your posts, followed you, or mentioned you — in a post, a comment or a
channel. Filter it to just **Mentions**; a chat mention opens at the message in its channel.
Click any name for their profile: posts, media, who they follow and who follows them.

A Space's posts reach the global feed only when the Space is **listed in Discover**: Space
Settings → Visibility → "Public space". A public join link on its own keeps posts members-only.

### Notifications
Desktop notifications work as soon as your browser grants permission. For notifications when no
tab is open, turn on background notifications under Account Settings → Notifications — on a
standard install the push gateway is already filled in (see
[`docs/push-notifications.md`](docs/push-notifications.md) for how it works). You're
also told when someone comments on or likes your post, or replies to your comment. Account
Settings → **Posts** turns comment and like notifications on or off.

To quiet a channel or DM, hover it and click the bell: **All messages**, **Only @mentions** or
**Nothing**. The bell in a Space's header sets the same for all its channels at once, and a
channel's own choice wins over its Space's. Quiet channels show an @ or a crossed-out bell in the
list; "Nothing" ones are dimmed.

### Making it yours
Account Settings → Appearance lets you set a status (Online/Away/Invisible + a message), add a
bio/banner/animated avatar, pick your own **typing status** (so the indicator says "Alice is
yelling…" instead of "is typing…"), and fully re-theme the app by pasting or loading a `.css` file. The
default look is "Mine", after the [Ultimit](https://github.com/m0nnnna/ultimit) desktop: glass panels over a
crystal-shard wallpaper, with a 12-hour clock above the member list and your notifications on a ticker
along the bottom. Appearance → Effects switches between **Full** (glass, blur, wallpaper, animation) and
**Safe** (flat and light, for a weaker machine); **Auto** picks for you. Ultimit's other skins ("Amber",
"Silver", "Verdant"), a pink "Sakura", the contributed "Royal Neon" (a purple cat behind the glass), the previous default "Nightfur", "Y2K Chatroom" and "Lola" are one click away, or write your own. Space Settings lets you
set a nickname scoped to just that Space, independent of your global display name.

Your profile can also have a **page**: on your profile, **Build your page** opens a page builder
with colours, a background, fonts, an effect, and blocks (text, link buttons, images, a gallery, a
profile song, your Spaces). It saves a draft as you go and shows nothing until you publish. See
[`docs/profile-pages.md`](docs/profile-pages.md).

On a phone, Account Settings → **Install Purrlor** adds it to your home screen as an app (on an
iPhone, background notifications only work that way). Sharing a link or text to the installed app
opens a new post with it.

## Features

### Messaging
- Real-time timeline with inline images, file/attachment uploads (video/audio players, download
  cards for everything else), and transparent E2EE for encrypted rooms.
- Markdown formatting (bold/italic/code/strikethrough), Discord-style `||spoilers||`, and fenced
  code blocks with syntax highlighting (Prism.js).
- `@mention` autocomplete with real push-rule-triggering mentions, plus `@room` mass-mentions
  (permission-gated, same power level as kick/ban).
- Reactions, threads, in-place message editing with full edit history, quote-reply, message
  forwarding, and private cross-room saved messages/bookmarks.
- Pinned messages, read receipts, typing indicators, and unread/mention badges that clear
  correctly server-side.
- Server-side message search (per-room or global) with jump-to-and-highlight on the result.
- Every real `@mention` is logged privately and shows in Notifications, alongside likes,
  comments and follows, so you can jump back to it later without scrolling back through a busy
  channel.
- Slash commands: `/me`, `/shrug`, `/nick`, `/topic`, `/invite`, `/kick`, `/ban`, `/unban`, `/leave`.
- Custom animated emotes and stickers via MSC2545 image packs (interoperable with Element/cinny/
  FluffyChat) — per-channel or space-wide, managed from a permission-gated picker.
- A **global emote library**: anyone can add their own emotes and stickers for everyone on the
  server to use in any channel, DM or post. Its moderators can hide an image, remove someone's
  whole set, or mute them from adding more (Manage Emotes & Stickers → Moderate the global
  library). The installer sets it up; on an older install, run `sudo purrlor emotes setup` once.
- Rich link/URL previews (server-side OpenGraph unfurling, no client-side scraping).
- Drag-and-drop and paste-to-upload for attachments.
- Discord-style channel categories (collapsible) inside a Space; channels and categories are
  arranged by dragging them in the channel list (a long press on a touch screen). Spaces are
  dragged into your own order in the server rail, kept where Element keeps it.

### Voice & Video
- Voice channels as a distinct channel type — join instantly from the channel list, with a live
  occupant list (avatar, name, mute/deafen state) shown inline.
- Calls are owned independently of whatever's selected in the main pane, so switching to a text
  channel doesn't hang up; a persistent call bar lets you get back to it from anywhere.
- One LiveKit deployment per Space, shared by every voice channel in it. Joining is gated through
  a Matrix-membership-checked token server (`services/token-server/`) — a Matrix OpenID token
  proves identity, a service-bot account confirms room membership, only then is a scoped LiveKit
  token minted.
- That service bot manages its own membership: the token server publishes its account ID, Space
  Settings picks it up from the token endpoint, and voice channels invite it themselves — at
  creation for new ones, on first join for older ones. A Matrix invite doesn't cascade from a
  Space to its channels, so without this every voice channel needed a manual invite of an
  account whose ID wasn't shown anywhere. See `docs/voice-architecture.md`.
- Audio-first participant grid (speaking indicator, mute/deafen badges, per-participant local
  volume control, connection-quality indicator), webcam video, and screen sharing (with audio)
  with a pop-out window and H.264-preferred encoding for GPU-friendly decode.
- Push-to-talk (hold-to-talk, rebindable from the call controls; defaults to Right Ctrl).
- **Watch Together** — start a shared YouTube or direct media link for the whole call, playing in
  the same slot screen share uses. Only small control messages (play/pause/seek/stop) cross
  LiveKit's data channel; every participant's browser plays the source independently, kept in
  sync. Anyone can control playback, reflected live for everyone else.
- **Listen Together** — the same sync for music: a compact Now playing card beside the call bar,
  so it keeps playing whichever channel you're in. Direct audio files (MP3, M4A, OGG, Opus, FLAC,
  WAV…) play with no picture; YouTube and YouTube Music links show a small player, because
  YouTube's terms don't allow separating a video's audio from its picture. Volume is per person,
  and deafening mutes it.

### Posts
- Every member gets a **feed** inside a Space — post under your own name, readable by everyone in
  the hub. The **Posts** view at the top of the channel list merges the whole hub's timeline;
  a Yours tab shows only your own.
- Posts share the message pipeline, so inline Markdown and custom emotes work the same way they
  do in a channel. New posts deliberately don't notify — they're a custom event type no push rule
  matches — so following the whole hub doesn't mean being pinged by it.
- **Likes and comments** on every post. A like is an ordinary ❤️ reaction; a comment carries text
  and up to four images or videos, like a post, with its media encrypted unless the post is
  public. Comment on anyone's public post without joining anything first: liking or commenting
  joins the post's feed for you. Delete your own comments, or anyone's under your own posts.
- **Replies**: answer a specific comment, and only that comment's author is notified, through
  standard Matrix mentions. Replies show "Replying to …".
- **A page per post**: timelines show a post's newest 3 comments; "View all" or **Open** goes to
  the post's own page with the whole thread, loaded a page at a time, so a thread of any length
  never stretches a feed.
- **Notifications** when someone comments on or likes your post (in the app and through
  background push), each switchable under Account Settings → Posts.
- A post is either public or **only you**. Because Matrix has no per-event visibility, that isn't
  a flag: a public post is an event in your feed room, while a private one lives in your account
  data and was never in a room at all. Publish it later, or take a public post back the same way.
  See [`docs/posts.md`](docs/posts.md).
- Posts carry **images and video** (JPG, PNG, GIF, WebP, WebM, MP4, up to four). JPG and PNG are
  converted to WebP in the browser before upload, so they're usually a fraction of the size.
- A **global feed** (the globe under Home). **Everyone** shows posts from every public Space on
  your server, including ones you haven't joined, plus everyone's **Global** posts. Only Spaces
  listed in the directory (Space Settings → Visibility → "Public space") count; unlisted Spaces never do. **Following**
  shows the people and whole Spaces you follow. Nothing is joined to read any of it.
- Post to **Global** or any of your Spaces from one composer. **Repost** between public places,
  or within the same private Space, with an optional comment — never from somewhere private to
  somewhere more visible. Every author has a **profile** with their bio, banner, a Follow button,
  and their posts. See [`docs/posts.md`](docs/posts.md).
- **Private Spaces keep their posts private**: their feeds are members-only, and media in them
  (and in "Only me" posts) is encrypted in the browser before upload, so a file's URL is useless
  to anyone who isn't meant to see it. See [`docs/posts.md`](docs/posts.md#private-spaces).
- Each feed is its own Matrix room, restricted to the Space (world-readable only for a public one), discovered through
  a key on the author's own membership of the Space — so it needs no admin permission to start
  one, and nothing pollutes the channel list.

### Spaces, Channels & Servers
- Create and manage Spaces (servers) and channels, with a permission-gated Settings modal:
  rename/topic/avatar, member management (invite, promote/demote roles, kick/ban/unban — all
  backed by real Matrix power-level checks), a Categories tab, and a Space-wide moderation audit
  log (invites, kicks, bans, power-level and topic changes, deletions).
- Space roles reach every channel: a Space moderator is a moderator in its channels too. Per
  channel (its "⋯" → Permissions): **announcement** channels only moderators post in (everyone
  can react), **moderators-only** channels nobody else sees, and **slowmode** — see
  [`docs/channel-permissions.md`](docs/channel-permissions.md).
- **Custom roles** between Member and Admin (Space Settings → Roles: a name, a colour, a level),
  the lowest role that can delete messages, pin, remove, ban or invite, and **channel-only
  moderators** (a channel's Permissions) — see [`docs/roles.md`](docs/roles.md).
- **Report review and automod**: reports about a Space's messages reach its moderators, who act
  on them in Space Settings → Reports; a list of blocked words is refused in Purrlor and deleted
  when sent from other apps — see [`docs/moderation.md`](docs/moderation.md).
- **Events**: each Space has a calendar (its "Events" entry) that moderators add to and members
  RSVP to, with a reminder 15 minutes before anything you're going to. Any message can be set to
  come back later as a reminder too (its bell) — see [`docs/calendar.md`](docs/calendar.md).
- **Webhooks**: a channel's "⋯" → Webhooks gives a URL that CI, monitoring or anything that can
  send Discord- or Slack-style webhooks posts into the channel with, marked APP — see
  [`docs/webhooks.md`](docs/webhooks.md).
- Per-server nicknames — a display-name override scoped to one Space, layered on top of Matrix's
  per-room `m.room.member` override.
- Add an existing room as a channel, or discover and join public Spaces/rooms via a directory
  browser (search + one-click join). Joining a Space joins its channels too, except invite-only
  ones and ones you've left (`matrix/autoJoin.ts`). Anything you're not in shows under "More
  channels", with one-click join per channel or **Join all**.
- Full invite flow — accept or decline pending invites (Space, channel, or DM) from a dedicated
  Invites list.
- **Public or unlisted**, shown and changed in Space Settings → Visibility: a listed Space appears
  in Discover and its posts reach the global feed. The setting shows the server's own answer.
- Shareable invite links for Spaces (Settings → Visibility) — anyone with the link joins
  instantly, without listing the Space in the public directory. Turning the link off invalidates
  every copy of it at once.

### Security & Encryption
- End-to-end encryption via `matrix-js-sdk`'s Rust crypto engine, with cross-signing, secret
  storage, and key backup set up automatically at registration.
- New DMs are end-to-end encrypted, and so are new private channels unless you untick
  "End-to-end encrypted" when creating one (public channels start unencrypted, since anyone can
  join them). An existing channel's "⋯" → Permissions can turn encryption on; Matrix can't turn
  it off again, which it says before you save. Webhooks can't post in encrypted channels.
- Recovery-key restore flow for new sessions that can't yet decrypt history (standard recovery
  key or a custom passphrase).
- Interactive emoji (SAS) device verification, both for your own devices and for verifying
  another user's identity from their profile. QR-code verification isn't offered.
- Session/device management — see and sign out any device from Account Settings.

### Notifications
- Desktop notifications, gated by the same push-rule evaluation the server uses.
- Per-channel, per-DM and per-Space levels (All messages / Only @mentions / Nothing), as the same
  per-room push rules Element uses, so badges, desktop and background notifications all follow
  them — see [`docs/notification-settings.md`](docs/notification-settings.md).
- Background push notifications when no tab is open, via a dedicated push gateway
  (`services/push-gateway/`) that bridges Matrix's Push Gateway API to real Web Push (VAPID) —
  see [`docs/push-notifications.md`](docs/push-notifications.md).
- Post activity: comments and likes on your posts (through push rules Purrlor keeps on your
  account, one pair per feed you own) and replies to your comments (through mentions). Clicking
  one opens the post, not a raw room.

### Customization & Theming
- Full custom theming — Account Settings → Appearance is a raw-CSS editor (paste or load a
  `.css` file), applied instantly. Every color/spacing/radius/font value in the app routes through
  a `--nu-*` token (`src/styles/tokens.css`), so a theme only needs to override tokens, not hunt
  down individual components.
- Ships with the Ultimit-style "Mine" default (black glass, shard wallpaper, ice accent) and
  presets: Ultimit's Amber, Silver and Verdant skins, a pink Sakura, the contributed Royal Neon
  (purple and magenta, with its cat art as the wallpaper), the previous default "Nightfur", the glossy
  "Y2K Chatroom", the black-and-hot-pink "Lola", Foxy and Halloween.
- Expanded profiles — bio, banner, and animated (GIF/WebP) avatars, on top of Matrix's bare
  `displayname`/`avatar_url`, via MSC4133 extended profiles.
- A custom **typing status**: set your own word for "typing" in Account Settings, and everyone
  sees "Alice is yelling…" when you're composing, in every channel and DM. Two people typing
  read "Alice is yelling and Bob is typing…".
- Custom status (Online/Away/Invisible + a free-text status message), visible to others.
- Responsive layout — below 900px width the shell becomes a one-screen-at-a-time mobile flow.

### Known scope limits
- Room join rules: private/public only (no restricted/knock rules, no room-version selection).
- Role/permission management is per-Space only — Matrix doesn't cascade a Space's power levels
  down to its channels.
- Only emoji-SAS device verification is offered (no QR codes).
- The Space-wide audit log is a rolling recent log derived from locally-loaded timeline events,
  not a complete historical archive.

## Self-hosting

Your own Purrlor — chat, voice and video, posts, and its own Matrix homeserver — on one server,
in about ten minutes.

### What you need

- **A server** running Alpine Linux (3.20 or newer), Debian 12, or Ubuntu 22.04/24.04, with a
  public IP and root access.
  2 GB of RAM is enough to run it (the installer adds swap if the build needs more).
- **A domain** you can add DNS records to.
- These ports open at your provider's firewall: **80, 443, 7881/tcp, 7882/udp**, and **8448**
  for Matrix federation. The installer opens them in `ufw` for you if it's active.

### Install

SSH into the server and run, on **Alpine** (as root):

```sh
wget -qO- https://raw.githubusercontent.com/m0nnnna/Purrlor/master/install.sh | sh
```

or on **Debian / Ubuntu**:

```sh
curl -fsSL https://raw.githubusercontent.com/m0nnnna/Purrlor/master/install.sh | sudo sh
```

It downloads Purrlor into `/opt/purrlor` and asks a few questions: your domain, your email, and
the name and password for your admin account. Then it shows you the DNS records to create
(usually four: `app.`, `livekit.`, `matrix.` and the domain itself) and waits, checking, until
they're in place. After that it does the rest on its own — installs Docker, nginx and certbot, sets
up the homeserver with your account, gets HTTPS certificates, and starts everything — and checks
the finished install from the outside, the way a browser would.

When it's done, open `https://app.<your domain>` and log in. Voice channels and notifications
already work; there's nothing to configure in the app. To invite people, give them the sign-up
code the installer printed.

### Afterwards

The installer adds a `purrlor` command:

| Command | What it does |
|---|---|
| `purrlor info` | The install summary again: the address, how to log in, the sign-up code |
| `purrlor status` | What's running, and whether each part answers |
| `purrlor doctor` | Checks everything from the outside and says what's wrong (DNS, firewall, certificate) |
| `purrlor update` | Pulls the latest Purrlor and restarts onto it |
| `purrlor logs [service]` | Follows the logs |
| `purrlor backup` | Saves your settings and all data to a file (`backup schedule daily` for nightly ones, `backup copy-to` to copy them to another server) |
| `purrlor restore <file>` | Puts a backup back, saving how things are first |
| `purrlor alerts <url>` | Messages you (ntfy, Discord, Slack) when something's down, a disk is filling up, or a backup failed |
| `purrlor errors` | What went wrong in the services and in people's browsers, grouped, newest first |
| `purrlor metrics` | Requests, response times, errors and memory for each service (`metrics prometheus` to collect them) |
| `purrlor peers add <address>` | Federates with another Purrlor instance: its people and public Spaces show here (each side adds the other) |
| `purrlor new-invite-code` | Replaces the sign-up code |
| `purrlor open-signups` / `close-signups` | Allows or stops new sign-ups |
| `purrlor emotes setup` | Creates the global emote library, owned by the admin (once; the installer already does it) |
| `purrlor bugs` | Bug reports people sent with `!bug`, each open or resolved by whom (`bugs <project>`, `bugs --open`, `bugs --limit N`, `bugs resolve <id>`, `bugs reopen <id>`) |

#### Bug reports

People send them from the app with `!bug <project> <what's wrong>`. Set it up in `.env`, then
`purrlor restart token-server`:

```sh
BUG_PROJECTS=purrlor,ultimit          # what <project> may be (default: purrlor)
BUG_REPORT_ADMINS=@you:YOUR_DOMAIN    # who the bot invites to its "Bug reports" room
```

| Where | What | What it does |
|---|---|---|
| The app | `!bug <project> <what's wrong>` | Sends a bug report to the admins, filed under that project |
| Bug reports room | Tap the ✅ under a report | Marks it resolved; the bot edits it to say who did |
| Bug reports room | Reply `fixed`, `resolved` or `done` | The same, by reply ("fixed in 1a2b3c" works) |
| Bug reports room | Reply `reopen`, or take your ✅ back | Opens it again |
| The server | `sudo purrlor bugs` | The last 50, each open or resolved by whom |
| The server | `sudo purrlor bugs <project>` | Only that project's |
| The server | `sudo purrlor bugs --open` | Only those not resolved yet |
| The server | `sudo purrlor bugs --limit N` | The last N instead of 50 |
| The server | `sudo purrlor bugs resolve <id>` | Marks one resolved (its ID is the list's first column), and edits its notice in the room |
| The server | `sudo purrlor bugs reopen <id>` | Opens it again |

The list's options combine: `sudo purrlor bugs purrlor --open --limit 200`. `resolve` and
`reopen` take an optional `--reason "fixed in 1a2b3c"`, which is shown on the report and kept in the
audit log. See
[`docs/bug-reports.md`](docs/bug-reports.md).

### Your Terms of Service

The login and register screens link to your server's Terms of Service. Purrlor ships only a
sample ([`apps/web/public/terms.html`](apps/web/public/terms.html)), with placeholders such as
`[SERVER NAME]` and a note at the top saying it's the sample. Your own terms go in
`custom/terms.html` in the install folder (the installer starts it as a copy of the sample). Git
ignores that folder, so `purrlor update` never replaces your terms.

To write or change them:

1. Edit `custom/terms.html` (e.g. `/opt/purrlor/custom/terms.html`). It's a plain HTML page: the
   app shows what's inside `<main>`, and the whole page is at `https://app.<your domain>/terms.html`
   for linking to. Replace every `[PLACEHOLDER]`, delete the sample note, and update the effective
   date.
2. Run `purrlor restart web`. The new terms show straight away, with no rebuild.

If the file is missing, the app shows the sample. If you're upgrading an install from before
this, create `custom/terms.html` before running `purrlor update`, or your server will show the
sample terms.

### Other setups

The installer also handles, when you say so:

- **nginx on another server you already run** — e.g. an edge box reached over WireGuard, often
  with Cloudflare in front. It skips nginx and certificates here, has the services listen on this
  server's private address, and writes the nginx config for that server (plus the relay for
  voice/video ports) into `deploy/edge/`, with instructions.
- **An outbound proxy** for servers that reach the internet through one, including a
  [NekoProxy](https://github.com/m0nnnna/nekoproxy) agent on the same server (`localhost:8080`).
- **Cloudflare's proxy** in front (orange cloud) — recognised as correct in the DNS check.
- **A homeserver you already run** (Synapse, Conduit, …) instead of the bundled one, and a TURN
  relay to hide the server's IP from people in calls. To run it from a checkout you already have:
`sudo bash deploy/setup.sh`. For doing everything by hand, running nginx on a different machine,
and what every piece is for, see [`docs/deployment.md`](docs/deployment.md).

## Development

```bash
cd apps/web
npm install
npm run start
```

Then point the app at any Matrix homeserver you have an account on (defaults to `matrix.org` in
the login form). The dev server has no `/config.json`, so the homeserver field is never locked
there.

**If the repo lives on a network share whose ACLs deny Execute permission**, npm's native
binaries (esbuild, etc.) will fail with "Access is denied." Work around it by running
`npm install`/`npm run build`/`npm run start` from a local disk instead — keep the network share
as your canonical/edited copy and sync to a local mirror before each run:

```bash
robocopy \\your\network\share\apps\web C:\local\mirror\apps\web /MIR /XD node_modules dist
cd C:\local\mirror\apps\web
npm install && npm run start
```

`deploy/docker-compose.dev.yml` is an alternative that bind-mounts `apps/web` into a container and
keeps `node_modules` in a Docker volume — works well on a normal local disk, but Docker Desktop's
bind-mount support for some network-share configurations can be unreliable; if you hit stale or
empty directory listings inside the container, fall back to the local-mirror approach above.

## Demo mode

Open the app with `?demo` (`http://localhost:8080/?demo`), or click "Just looking? Take a tour
with sample data" on the login screen, to run the entire UI against a fabricated in-memory Matrix
world — no homeserver, no LiveKit, no network at all. It's for reviewing a theme, checking a
layout change, or showing someone what Purrlor is without deploying anything first.

What's in it: two Spaces (one with voice fully configured, one with none), categorized text and
voice channels, a seeded conversation with Markdown/code blocks/spoilers/reactions/mentions, DMs
and a group chat, and members at a range of power levels. Sending a message, saving Space
Settings, and inviting someone all really do update the world — it's built on genuine
matrix-js-sdk `Room` and `MatrixEvent` objects, so the app's own read paths run unmodified rather
than against a second, hand-written imitation of them.

Voice deliberately stops one step short of connecting. The fake token server implements the real
endpoint shapes, so selecting the "AFK" channel genuinely exercises the service-bot self-heal —
invite, `voice_bot_not_in_room`, "Setting up voice for this channel…", recovery once the bot
joins — but it never mints a LiveKit token, because there's no LiveKit to connect to. The in-call
UI (participant grid, control bar, Watch Together) therefore isn't covered by demo mode and still
needs a real deployment.

Demo mode is entered only from the URL, never persisted, and never touches a stored session; a
banner stays on screen throughout so demo data can't be mistaken for the real thing. It lives in
`apps/web/src/demo/` and is pulled in through a dynamic `import()`, so it's a separate ~13 KB
chunk that anyone running against a real homeserver never downloads.

## Testing

`npm test` (Vitest, `apps/web/vitest.config.ts`) runs the unit suite — pure logic that doesn't
need a live Matrix client or homeserver: message formatting/rendering, permissions, direct
messages, replies, room emotes/nicknames/directory/audit-log helpers, and the Watch Together sync
hook (via a faked LiveKit room).

Components wired directly to a `MatrixClient` are covered through demo mode's fake client
(`src/demo/*.test.*`): the real `ChannelList` and `MessageTimeline` are rendered against the
seeded world, and the voice service-bot self-heal is driven end to end through the unmodified
`useVoiceConnection` against the fake token server's real HTTP shapes.

`npm run e2e` (Playwright, `apps/web/e2e/`) runs the production build in Chromium against a real
Continuwuity in Docker: signing in, sending and receiving, reactions, posts, notification settings,
and an encrypted chat between two browsers. CI runs it on every push; see
[`apps/web/e2e/README.md`](apps/web/e2e/README.md) to run it locally. Still not covered anywhere:
device verification and a live LiveKit call — run the app against a real deployment for those.

## Production deployment

`deploy/docker-compose.yml` builds and runs all of Purrlor's own services together. Both
Dockerfiles use a repo-root build context so they can `COPY` a single package into an otherwise-
empty image without pulling in the other package's `node_modules` (see `.dockerignore`).

Every service's published port is bound to `127.0.0.1` except LiveKit's real-time-media ports
(`7881/tcp`, `7882/udp`, and — with TURN hardening enabled — `5349/tcp`/`3478/udp`), which can't be
proxied through nginx and need to reach the internet directly. nginx is meant to be the only thing
actually facing the internet, terminating TLS and proxying to `127.0.0.1:<port>` for everything
else — see `deploy/nginx/` for reverse-proxy examples.

See [`docs/deployment.md`](docs/deployment.md) for the complete guide, including DNS, TLS, the
guided installer, and the split edge-proxy/origin topology for running nginx on a separate box
from the app services.
