# Bug reports

Anyone signed in on this server can send the admins a bug report from any channel or DM, and so can
someone from another server who's in one of this server's Spaces (see "From another server" below):

```
!bug <project> <what's wrong>
!bug purrlor emojis don't work on mobile
```

The first word after `!bug` is the **project** the report is filed under; the rest is the report.
The message is never posted in the channel. The composer says "Bug report sent to the admins,
filed under purrlor", or why it wasn't sent: an unknown project (it lists the ones there are), no
text, more than 2000 characters, or too many reports at once (five, then one every two minutes).
`!bugs …` and `!bug` in the middle of a message are ordinary messages.

## Setting it up

Two settings in `.env`, then `purrlor restart token-server`:

| Setting | What it does |
| --- | --- |
| `BUG_PROJECTS` | What `<project>` may be, separated by commas or spaces: `purrlor,ultimit,nte`. Letters, digits, `-` and `_`, up to 32 characters; case doesn't matter. Default `purrlor` |
| `BUG_REPORT_ADMINS` | Full Matrix IDs of the people to tell: `@you:YOUR_DOMAIN,@other:YOUR_DOMAIN` |

With the first report, the service bot makes a private, unencrypted room called **Bug reports** and
invites everyone in `BUG_REPORT_ADMINS`. Accept the invite and each report arrives there as a notice:

```
🐞 Bug report [purrlor] from @luna:purr.example (mobile, version 1a2b3c4)
emojis don't work on mobile
```

"mobile", "desktop app" or "browser" and the app's version come from the app, so you needn't ask.
Anyone added to `BUG_REPORT_ADMINS` later, or who declined or left the room, is invited again with the
next report; to stop getting them, take yourself off the list. If the bot is removed from the room,
it makes a new one. The room isn't encrypted because the service bot has no encryption keys.

## Marking one resolved

The bot puts a ✅ under each report. Tap it to mark the report resolved, or reply to the report
with "fixed", "resolved" or "done" (anything starting with one of those words, so "fixed in 1a2b3c"
works). The bot edits the report to start "✅ Resolved by @you". Reply "reopen", or take your ✅ back,
to open it again; it then starts "🔁 Reopened by @you".

Only the accounts in `BUG_REPORT_ADMINS` can do this; anyone else's ✅ or reply is ignored. The
reporter isn't told. A report sent before ✅s existed has none under it, but replying "fixed" to it
works: the bot looks the notice up, finds its report by the text, and links the two from then on.

On the server, `sudo purrlor bugs resolve <id>` and `sudo purrlor bugs reopen <id>` do the same by
the report's ID (the first column of `purrlor bugs`), for any report, and edit its notice to say
"✅ Resolved by <your login>". An optional `--reason "fixed in 1a2b3c"` is shown on the notice and
in the list, and both go in the audit log (`bugs.resolve`, `bugs.reopen`).

## From another server

A report goes to the server that hosts the Space it was typed in, not to the reporter's own server:
someone from `cats.example` in one of your Spaces who types `!bug` reaches your admins. In a DM, or a
room in no Space, it goes to the reporter's own server as before. The notice says where it came from:

```
🐞 Bug report [purrlor] from @mochi:cats.example (browser, version 1a2b3c4) in Cozy Corner
the voice channel drops after a minute
```

Their app finds your token server from your instance's address on its peer list, then the Space's
voice token server, then your server name itself (`https://purr.example`), and sends the report only
to an address whose `GET /api/public/bugs` names your server. Your token server takes it only if the
Space is one it serves (made on this server, with the service bot in it, the same Spaces voice
works in: `docs/voice-architecture.md`) and the reporter has joined it. If none of that works out,
they're told the Space's server doesn't take bug reports, and nothing is sent anywhere else.

`BUG_PROJECTS` is your list, so they file under your projects. Their own server needs the version
of the app that does this; an older one still sends to its own server.

## Reading them on the server

Every report is also kept, whether or not the room could be reached:

```sh
sudo purrlor bugs                 # the last 50, each open or resolved by whom
sudo purrlor bugs purrlor         # one project
sudo purrlor bugs --open          # only those not resolved yet
sudo purrlor bugs --limit 200
sudo purrlor bugs resolve a1b2c3d4e5f6 --reason "fixed in 1a2b3c"
sudo purrlor bugs reopen a1b2c3d4e5f6
```

Each line of the list starts with the report's ID:

```
a1b2c3d4e5f6  2026-10-14 23:41  [purrlor]  open  @mino:purr.meowops.net  (browser, version 5327571)
    emojis are off center on mobile
```

They're kept in `bug-reports.jsonl` in the token server's data volume, one JSON line per report
(`id`, `at`, `project`, `reporter`, `text`, `platform`, `version`), and only ever added to. What
happens to a report afterwards goes in the same file as lines with a `kind`: `posted` (the
notice's event ID), `resolved` and `reopened` (who, when, and the room event that did it, so
seeing the room's history again after a restart changes nothing). The
room's ID is in `bug-room.json`; delete that file to have the bot make a fresh room.

## How it works

The bot never reads anyone's messages (docs/voice-architecture.md), and couldn't in an encrypted
room anyway. So the app catches `!bug` as it's sent (`apps/web/src/matrix/bugReport.ts`) and posts
it to the token server with a Matrix OpenID token, the same proof of who's sending as the online
count uses. The token server (`services/token-server/src/bugReports.ts`) checks it, keeps it, and has
the bot post it. That means `!bug` works only from Purrlor, not from other Matrix apps, and only for
accounts on this server or members of its Spaces. The bot does read the Bug reports room, which it made for the admins,
to see the ✅s and replies; no other room's messages.

`POST /api/public/bugs` takes `{ openid_token, project, text, platform?, version?, space_id? }` and answers
`{ id, project, delivered }`. `delivered` is false when the report was kept but the room couldn't
be told, for example because `BUG_REPORT_ADMINS` is empty. It refuses with `400` (bad project or
text, with `projects`), `401` (login didn't check out), `403` (an account on another server, without a Space
served here that it's in) or `429`. `GET /api/public/bugs` lists the projects and gives this server's
name (`serverName`). Both are open to any page (CORS), since a visitor's app is at another address.
