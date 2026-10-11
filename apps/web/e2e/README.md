# End-to-end tests

The production build in Chromium, against a real homeserver: a fresh Continuwuity in Docker with
no other server to federate with, plus the token server built from this checkout (for webhooks and the online count) and a LiveKit in dev mode (for calls). Each test registers its own users and makes its own rooms through the client-server
API (`matrix.ts`), drives the app through its `data-nu-role` attributes (`app.ts`), then checks what
actually reached the server. Tests share nothing, so they run in parallel and can be rerun against
the same server.

| Spec | What it covers |
|---|---|
| `messaging.spec.ts` | Sign in, send a message another user receives, see their reply arrive, react; the composer keeping keyboard focus (on opening a channel, after an emoji, after attaching a file); a channel mention reaching Notifications and opening at the message |
| `posts.spec.ts` | Publish a post to a Space, which also creates your feed room |
| `notifications.spec.ts` | Space and channel notification levels become the right push rules and back |
| `channel-permissions.spec.ts` | Space moderators copied into channels, announcement channels (enforced by the server), moderators-only channels (members removed, hidden from the hierarchy, new moderators brought in), slowmode, a custom role and its permissions reaching the channels, a channel-only moderator |
| `moderation.spec.ts` | A report reaching the Space's moderators, who delete the message from the queue; automod refusing a blocked word in Purrlor and deleting one sent from elsewhere |
| `calendar.spec.ts` | A moderator adds an event and a member RSVPs (kept in their member event), an event reminder, and a message reminder from "Remind me" to opening it |
| `webhooks.spec.ts` | A webhook posting through a real token server under its own name (APP), wrong tokens refused, deleting it, and a person unable to pose as one |
| `voice.spec.ts` | A real call through LiveKit, with Chrome's fake microphone: three people listed in the order they joined, the same on each of their screens and in the channel list (live for the call you're in, polled through the token server for someone outside it); whoever is talking is lit up in both, and the order holds as the call goes on |
| `discover.spec.ts` | Discover lists a public Space but not its public channel, and joining it puts it on the server rail |
| `online.spec.ts` | The global feed's "N online", which goes up when another account opens the app, also shown signed out; a ping without a real account's token is refused |
| `encryption-settings.spec.ts` | New private channels and DMs are created encrypted, public channels aren't, and turning encryption on for an existing channel warns first |
| `chat-features.spec.ts` | A thread (replying from a message, another user's reply arriving in it), pinning and unpinning, finding a message by searching, sending a file from the composer, and an image sent on its own as a reply staying a reply, its quote jumping to the original |
| `news.spec.ts` | A Space's news shown on a member's first visit and then not, the Space opening on its first channel, a small fix that isn't shown again and an update that is; who may edit it set in Roles and held to by the homeserver |
| `direct-messages.spec.ts` | "Message" on a profile opens a DM (not a shared Space's two-person #general), coming back before the other person accepts reopens it, and they reach the same DM by pressing "Message" back (which accepts the invite) or from Invites; a DM you've had for a while (members not loaded yet) is reopened rather than duplicated; leaving a DM |
| `music-albums.spec.ts` | A creator uploads tracks into two albums in the page builder, gives one a year and a cover, moves a track between them and publishes, shown to everyone; the page shows a shelf of covers, an album opens over it and plays in the app's player, which keeps playing in the DMs and on a phone's feed; the album's and a track's links open it signed in and signed out (the public API through the token server), and the track's link previews with its title |
| `post-links.spec.ts` | A Global post's "Copy link", opened signed in (the post's page) and signed out (the public post and its preview), after it's been buried past the public web's window |
| `encryption.spec.ts` | An encrypted room between two browsers: each reads the other, the server sees only ciphertext |
| `security.spec.ts` | The security headers are sent, signing in, a channel and the feed run with no Content-Security-Policy violation, an injected inline script is refused, a theme's rules that read attribute values are left out while the rest applies, and the Halloween and Royal Neon presets apply in full, Royal Neon's cat art loading from the build |
| `your-data.spec.ts` | Download my data: your messages (an encrypted one as text), posts and uploaded file in the ZIP, nobody else's messages; Delete my account: a wrong password changes nothing, then posts and the public page go and the account can't sign in |
| `channel-drag.spec.ts` | Dragging channels within and between categories and to the top, and a category above another, with the mouse, all saved to the Space; a click still opens a channel; a member can't drag; on a touch screen a long press drags and a swipe doesn't; Spaces dragged into your own order in the rail, saved as account data and kept after a reload |
| `image-tags.spec.ts` | Tagging someone in a Global post's picture: placed by tapping it and picking them, saved on the picture as whole-number coordinates with the post mentioning them, their invite worded "Tagged you in a photo", and their name shown on the posted picture, opening their profile |
| `mobile.spec.ts` | On a phone the bottom tab bar replaces the rail: You opens your own profile, Spaces lists your Spaces and opens one, Home goes back to the DMs |
| `page-effects.spec.ts` | A profile page's effect falls for its owner (Full effects), and stands still, scattered, with reduced motion or Safe effects, where the wallpaper isn't drawn either |
| `page-background.spec.ts` | A profile page's background picture, "fill" and "stay put", keeps its size while a long profile scrolls and more posts load; "stay put" stays at the top, "fill" scrolls away |
| `link-previews.spec.ts` | A link in a channel message and in a post gets a preview card (the homeserver fetching a page the token server serves); a link in an encrypted conversation gets none, and the app never asks |
| `onboarding.spec.ts` | A new account gets the welcome guide: sets its name, finds and joins a public Space, lands in it, and never sees the guide again (after a reload too); one that skips it gets the ways in on the empty screen and joins by pasting an invite link; Account Settings opens the guide again. Every other spec's accounts are marked as welcomed (`createUser`) |
| `media.spec.ts` | An image in a channel loads from its media URL through the service worker (which adds the access token the homeserver wants), as a thumbnail inline and the whole file in the lightbox; an image shown once is kept in the device's media cache, which signing out deletes |
| `feed-cache.spec.ts` | The feed opened again after a reload shows its last posts before the homeserver answers, then gathers nothing again (no directory or `/state` reads) and asks the feed only for its newest posts, bringing in one posted meanwhile |
| `room-revisit.spec.ts` | A channel left scrolled up opens again at the same message without asking the homeserver for anything; one left at the bottom opens at the bottom |
| `session-verification.spec.ts` | Registering sets up cross-signing; a second session verified with the recovery key is signed by the account's self-signing key, which is what other Matrix apps check |

Effects are on Auto (`app/effects.ts`), which in headless Chromium, drawing in software, comes to **Safe**: no wallpaper, blur or animation. A test that needs Full sets `nekous_effects` in localStorage first (`page-effects.spec.ts`).

## Running locally

From `apps/web`, with Docker running:

```sh
npx playwright install chromium   # once
npm run e2e:homeserver            # a fresh server at 127.0.0.1:6167, token server at :6168, LiveKit at :7880
npm run build
npm run e2e
docker compose -f e2e/docker-compose.yml down
```

`npm run e2e` starts `vite preview` on port 4173 itself (or reuses one already running). The app
is pointed at the homeserver by answering its `/config.json` request, the same file a deployment
serves. `E2E_HOMESERVER` and `E2E_REGISTRATION_TOKEN` point the tests at another server.

On Windows with the repo on a network share, run from a local copy of `apps/web`, as for the unit
tests (see the main README). `start-homeserver.sh` needs bash (Git Bash works) and curl.

### Where the homeserver image comes from

It's pulled from `forgejo.ellis.link`, which some networks (a locked-down cloud coding session, for
one) can't reach. `E2E_HOMESERVER_IMAGE` points the tests at a copy instead:

1. Run the **Mirror homeserver image** workflow (Actions → Mirror homeserver image → Run workflow).
   It copies the image to `ghcr.io/<owner>/purrlor-e2e-homeserver:latest`; the run's summary prints it.
2. Set `E2E_HOMESERVER_IMAGE` to that in the environment that can't reach `forgejo.ellis.link`
   (and let it reach `ghcr.io`), then `npm run e2e:homeserver` as usual.

The mirror is a snapshot: run the workflow again to pick up a newer Continuwuity. CI itself doesn't
use it; it pulls from the source.

When a test fails, `npx playwright show-trace test-results/<test>/trace.zip` replays it step by
step. In CI the report and traces are uploaded as the `playwright-report` artifact, and the job
prints the homeserver's log.
