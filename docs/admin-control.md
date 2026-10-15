# The admin control socket

How the `purrlor` command on the server manages the public web: hiding pages, switching a public
page off, taking files down, deleting them from the homeserver, reading reports, and the audit log.
This is the contract the shell commands are built on. The service side is
`services/token-server/src/controlServer.ts` (the API), `control.ts` (the pure parts, tested in
`control.test.ts`), `adminStore.ts` (the files) and `adminRoom.ts` (the homeserver's admin room).

There's no admin web page, on purpose: it would be one more thing on the internet that can take
pages down and read reports. Root on the host is already the trust boundary for the whole install,
so the channel is a Unix socket only root can open.

## The socket

| | |
| --- | --- |
| On the host | `$PURRLOR_CONTROL_DIR/purrlor.sock`, default `/run/purrlor/purrlor.sock` |
| In the container | `/control/purrlor.sock` (`CONTROL_SOCKET`; empty turns it off) |
| Permissions | the directory `0700` and the socket `0600`, both root's |

The token server sets those permissions itself every time it starts, and refuses to listen (logging
`Admin control socket not started: …`, the rest of the service carries on) if the directory is a
symlink, belongs to another user, holds anything but the socket (so a mistyped `PURRLOR_CONTROL_DIR`
such as `/etc` is never made root-only), or something other than a socket is in the way. Being able to
connect is the authentication: there's no password or token. It's never bound to a port and nginx
never proxies it. `deploy/docker-compose.yml` mounts the directory; Docker creates it if it's
missing.

`/run` is emptied at boot; the token server makes the socket again when its container starts.

The `purrlor` command checks the other end before it sends anything (and the admin password is sent
for reports and deletions): it refuses a socket or directory that is a symlink, or that other users
can open. Text answers have control characters, C1 controls and bidi overrides removed, by the
server and again by the command, because they carry things other people wrote (an album title on a
page, a homeserver's error) that could otherwise drive the admin's terminal. Admin room commands
count only the homeserver's own answer (`@conduit:<server>`), so nobody else in the room can make a
file read as deleted.

## Talking to it

HTTP over the socket, with `curl --unix-socket`. Answers are plain text meant to be printed as they
are, or JSON (`{ ok, message, … }`) with `Accept: application/json`. The status code says how it
went: `200` done, `207` partly done (some deletions failed), `400` something given was wrong, `404`
no such thing, `502` the homeserver refused or didn't answer, `500` a bug.

Fields go as a form (`--data-urlencode`), so nothing has to be quoted or escaped by the shell and no
JSON is ever built from what an admin typed. A field that takes several values is repeated
(`--data-urlencode target=a --data-urlencode target=b`). The admin's password is read from standard
input (`--data-urlencode adminPassword@-`), never put on a command line.

```sh
sock=/run/purrlor/purrlor.sock
curl -fsS --unix-socket "$sock" http://purrlor/pages/luna
curl -sS --unix-socket "$sock" http://purrlor/pages/luna/hide \
  --data-urlencode "actor=${SUDO_USER:-root}" --data-urlencode "reason=$reason"
```

The host part of the URL (`purrlor`) is ignored. Use `-sS` without `-f` for actions, so a `400`
still prints its message.

Every request may carry `actor`, the admin's own login name (`SUDO_USER`), for the audit log. It's
checked against a user-name pattern and is `root` when missing or odd.

### Who is meant

`:user` is a name on this homeserver: `luna`, `@luna` or `@luna:purr.example`. Anything else (another
server, characters a user name can't have) is `400`.

### Files

A file is given as its `mxc://server/id`, or as any link to it an admin is likely to have been sent:
the public media link (`https://purr.example/api/public/media/server/id?width=…`) or a homeserver
download or thumbnail link. Anything that doesn't read as exactly one file ID is refused, and a
takedown with one bad target changes nothing.

## Actions

A **reason** (`reason=…`) is required wherever something is hidden, switched off, blocked or
unblocked; it goes in the audit log. The rest accept one.

### Pages

| Request | What it does |
| --- | --- |
| `GET /pages` | Who is hidden, and whose public page is switched off |
| `GET /pages/:user` | One person: profile room, page built, their own switch, hidden, switched off, and whether signed-out visitors see the page |
| `POST /pages/:user/hide` (reason) | Hides their page **and** their Global posts from signed-out visitors, now. The signed-in app shows their own page with a note that an admin hid it |
| `POST /pages/:user/unhide` | Shows them again |
| `POST /pages/:user/public-off` (reason) | Keeps their page off the public web whatever their own switch says. Their Global posts stay public (they always are); their page's files stop being served |
| `POST /pages/:user/public-on` | Their own switch decides again |

Both lists take effect on the next request. `GET /api/public/status/:user` reports both
(`{ "hidden", "publicOff" }`) so the app can tell the owner.

### Takedowns

A takedown works at two levels: the file is **blocked** on the public media route at once (and its
local copy deleted), and it's **queued for deletion** from the homeserver, which needs the
homeserver admin's password and so is a separate step.

| Request | What it does |
| --- | --- |
| `POST /takedown/media` (target…, reason) | Blocks and queues those files |
| `POST /takedown/user/:user` (reason) | Blocks and queues every file the public web serves for them now: their Global posts' pictures and video, their page's files if it's public, their avatar, and their banner if the page is public. Their page and posts stay up; hide them too with `pages/:user/hide` if that's wanted |
| `POST /takedown/album/:user` (album, reason) | Blocks and queues one art or music album (a music album's cover too), or a gallery or music block, found by its title or ID (any case). `404` if their page has none by that name |
| `POST /media/unblock` (target…, reason) | Serves them again where a public page or post still names them, and takes them out of the deletion queue unless they're already deleted |
| `GET /media` | The block list, with each file's deletion state |
| `POST /deletions/run` (adminUser, adminPassword) | Logs in to the homeserver as its admin, runs `!admin media delete --mxc <file>` in `#admins:<server>` for each queued or failed file, records each answer, and logs out. A file that fails stays blocked and is tried again next time. `207` if any failed |

Deleting needs Continuwuity's admin room (the bundled homeserver). With another homeserver the
answer is `502` with a note to use its own admin tools; the files stay blocked.

Only a file the media route serves can be blocked from the public web, but the queue deletes the
original on the homeserver, so signed-in people stop seeing it too.

### Reports

`POST /reports` (adminUser, adminPassword, optional `limit` of admin room messages to read, default
300, and `only=pages`) logs in as the admin, reads the reports Continuwuity posts in its admin room
(only notices the server itself sent), and says for each one whether it's about someone's page, a
post or guestbook entry in their profile room, or something else. Copyright complaints come by
email to the address in the terms; they aren't in the admin room.

### Addresses

`POST /ips/watch` (`seconds`, default 60, at most 240) records, for that long and in memory only,
each distinct combination of the connecting address, `X-Real-IP`, `X-Forwarded-For` and the address
`clientIp` settled on, with a count (`ipWatch.ts`; a middleware ahead of every route does nothing
while no watch runs). Then it answers with the list and `diagnose`'s notes, and drops it. Watches
started together share one recording. Audited as `ips.watch` with the duration and how many distinct
lines, never the addresses.

### Stats

`POST /stats` (adminUser, adminPassword) logs in as the admin, asks the homeserver for its account
list (`users list-users`) and counts the people in it (`countRegisteredPeople`: not `@conduit`, not
the service bot), then adds the token server's own totals: accounts online now (`online.ts`), people
with a profile feed, and pages shown to everyone. Totals only; the account list isn't kept or
returned. Audited as `stats`.

### Peers

The Purrlor instances this one federates with (`docs/federation.md`). `:user` in the page and
takedown actions above may be an approved peer's person too (`@name:peer.example`): hiding them
here keeps them off this site's public web, whatever their own instance does.

| Action | What it does |
| --- | --- |
| `GET /peers` | Each peer: its name, server name and address, who added it and when, and what the bot reads there (profile rooms, Spaces, feeds) and how its last sync went |
| `POST /peers/add` (url, reason) | Asks `<url>/api/public/instance`, and saves it as a peer if it's a Purrlor instance that federates and isn't this one. Adding one already there refreshes its address and name. Starts its first sync. `502` if it can't be reached |
| `POST /peers/remove/:server` (reason) | Takes it off the list and has the bot leave every room created on that server. `404` if it isn't a peer |
| `POST /peers/sync` | Reads every peer's directory now and joins what's new (otherwise every ten minutes). `207` if any failed |

### Bug reports

`GET /bugs?limit=50&project=…&open=1` shows the last bug reports sent with `!bug` and whether each is resolved, for one project or all,
([bug-reports.md](bug-reports.md)). Read-only, so no reason. `POST /bugs/:id/resolve` and
`POST /bugs/:id/reopen` (reason optional) change one by its ID and edit its notice in the Bug
reports room; `404` for an unknown ID, `200` saying so if it already stood that way.

### The audit log

`GET /audit?limit=50` shows the last entries.

## Files

In the token server's data volume (`/data`, root-only like the socket):

| File | What it holds |
| --- | --- |
| `hidden-pages.txt` | Hidden user IDs, one per line (`#` comments allowed) |
| `public-off.txt` | User IDs whose page an admin switched off |
| `blocked-media.txt` | Blocked `mxc://` URLs |
| `media-deletions.json` | The deletion queue and how each deletion went |
| `peers.json` | The approved peers: server name, address, name, who added it and when |
| `bug-reports.jsonl` | One JSON line per bug report sent with `!bug`, and one per change to it (posted, resolved, reopened); only ever appended to |
| `bug-room.json` | The ID of the bot's "Bug reports" room |
| `audit.log` | One JSON line per action: `at`, `actor`, `action`, `target`, `reason`, `result` |
| `media-cache/` | Local copies of public sound and video (emptied when the service starts) |

The lists can be read, and in a pinch edited, by hand; the service notices a change within ten
seconds. The audit log is only ever appended to: it's opened for appending, never through a
symlink, and nothing in the service rewrites it. The admin's password is never written anywhere.

## What it can't do

It doesn't read encrypted messages, edit anyone's page, or see anything the public web doesn't
already serve, apart from the admin room's reports (with the admin's own password, for that one
request).
