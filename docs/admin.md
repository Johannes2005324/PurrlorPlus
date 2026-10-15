# Running the moderation side of the server

How the site owner hides pages, takes files down, reads reports and checks what was done, from the
server's terminal. There is no admin web page, on purpose: it would be one more thing on the
internet that can take pages down and read reports. Root on the host is already the trust boundary
for the whole install, so everything here needs `sudo`.

The commands are the `purrlor` command `deploy/setup.sh` links into `/usr/local/bin`. Under them is
a Unix socket only root can open (`docs/admin-control.md` is the contract and has the API), so no
password or token exists to leak and nothing is reachable from the network.

Every change needs a **reason**. Give it with `--reason "why"`, or leave it off at a terminal and
you'll be asked. It goes in the audit log with the time, your login name (from `sudo`), the action
and the target. Anything that hides or deletes also asks you to type `yes` first; `--yes` skips
that for scripts, but never the reason.

```sh
sudo purrlor pages hide luna --reason "reported: impersonation"
```

## Pages

| Command | What it does |
| --- | --- |
| `purrlor pages list` | Who is hidden, and whose public page is switched off |
| `purrlor pages show <name>` | One person: whether they have a page, their own public switch, whether an admin hid or switched them off, and whether signed-out visitors can see it now |
| `purrlor pages hide <name>` | Hides their page **and** their Global posts from people who aren't signed in, now. They still see their own page, with a note |
| `purrlor pages unhide <name>` | Shows them again |
| `purrlor pages off <name>` | Keeps their page off the public web whatever their own switch says. Their Global posts stay public, since Global posts always are |
| `purrlor pages on <name>` | Their own switch decides again |

`<name>` is a name on this server: `luna`, `@luna` or `@luna:purr.example`. Anything else (another
server, a `/`, a leading dot) is refused before anything is sent.

Use `hide` for a page or posts that shouldn't be public at all, and `off` when only the page is the
problem and the person's Global posts are fine.

## Takedowns

A takedown works at two levels. The file is **blocked** on the public web at once, and it is
**queued for deletion** from the homeserver, which is a separate step (`takedown run`) because it
needs the homeserver admin's password.

| Command | What it does |
| --- | --- |
| `purrlor takedown file <file>...` | Blocks and queues those files |
| `purrlor takedown user <name>` | Everything the public web serves for them: Global post media, their page's files if it's public, their avatar and banner. Their page and posts stay up: add `pages hide` if that's wanted too |
| `purrlor takedown album <name> <title>` | One art or music album, gallery or music block on their page, found by its title or ID |
| `purrlor takedown restore <file>...` | Serves blocked files again, and takes them out of the deletion queue unless already deleted |
| `purrlor takedown list` | What is blocked, and each file's deletion state |
| `purrlor takedown run` | Deletes every queued file from the homeserver. Asks for the homeserver admin's account and password |

A `<file>` is its `mxc://server/id` address, or any link to it you're likely to have been sent: the
public media link or a homeserver download link. One bad target in a command and nothing changes.
A file that fails to delete stays blocked and is tried again on the next `run`.

Deletion needs the bundled homeserver (Continuwuity's admin room). With another homeserver the files
stay blocked and you delete them with that server's own tools.

### A copyright complaint

Complaints arrive by email at the address in the terms (section 4), not through the app.

1. Find the file: `purrlor pages show <name>` for the page, then look at it as a signed-out visitor
   to get the file's link, or ask the complainant for it.
2. `sudo purrlor takedown file <link> --reason "DMCA complaint from <who>, <date>"`. It stops being
   served within the minute.
3. `sudo purrlor takedown run --reason "DMCA complaint from <who>"` removes the original.
4. If the complaint is about a whole album: `takedown album`. About everything a person has put
   public: `takedown user`.

## Reports

`purrlor reports` reads the reports people sent with "Report this page" and on posts, from the
homeserver's admin room, and says for each whether it's about someone's page, a post or guestbook
entry in their profile room, or something else. `--pages` leaves out the rest, and `--limit N` reads
that many admin-room messages (default 300). It asks for the homeserver admin's account and
password, which go over standard input and aren't stored.

## Stats

`purrlor stats` gives four totals:

| Line | Where it comes from |
| --- | --- |
| Registered accounts | The homeserver's own list (`!admin users list-users`), less the server's own account and the service bot. So it asks for the homeserver admin's account and password, like `reports` |
| Online now | Accounts with the app open in the last 2½ minutes (below) |
| With a profile feed | People who have posted to Global or made a page |
| Page shown to everyone | People whose page signed-out visitors can see now |

Totals only, on purpose: nothing names anyone, and nothing new is collected for them. The online
count is the same number the global feed shows everyone. While the app is open and showing, it
tells the token server so about once a minute, proving the account with a Matrix OpenID token.
The token server keeps, in memory only, a keyed hash of the account and when it last did. The key is
random and new each time the service starts, so the hashes can't be matched to accounts. Each entry
is dropped 2½ minutes after its last ping, and nothing is written to disk or logged (no address,
no device). Running `stats` goes in the audit log, as `stats`, without the numbers.

## Checking visitors' addresses

`purrlor ips [seconds]` shows what addresses reach the token server, for setting up the proxies in
front of it (`REAL_IP_FROM`, docs/public-web.md, "Deploying"). It watches for that long (default 60,
at most 240) while you browse the site, ideally from a phone off Wi-Fi as well, then prints each
address it counted (the one its rate limits use) with:

- **connected from**: the last hop before the token server, marked if it's in `REAL_IP_FROM`
- **X-Real-IP** and **X-Forwarded-For**: what that hop said the visitor was

and then what it means: visitors' own addresses are coming through; or `REAL_IP_FROM` names a hop
that never connects; or the edge sends no `X-Real-IP`; or the edge's `X-Real-IP` is itself a private
address, so the hop in front of the edge (a tunnel or relay that rewrites the source) is losing
them and needs to pass them on (the PROXY protocol). Every visitor counted as one private address
means everyone shares one rate limit.

Nothing is recorded except while it runs, and only in memory: the list goes to your terminal and
the token server keeps none of it. The audit log notes that a watch ran (`ips.watch`), not what it
saw.

This watches the token server only. The addresses in the app's Settings > Sessions come from the
homeserver, which takes them from the same `X-Real-IP` (`MATRIX_IP_SOURCE`, default `x_real_ip`;
see deploy/docker-compose.yml). So once `purrlor ips` shows visitors' own addresses, the sessions
list does too, from each session's next request.

## Bug reports

`purrlor bugs [project] [--limit N]` lists the bug reports people sent with
`!bug <project> <what's wrong>`, newest last. The service bot also posts each one in a "Bug reports"
room for the accounts in `BUG_REPORT_ADMINS`. See [`docs/bug-reports.md`](bug-reports.md).

## The audit log

`purrlor audit` shows the last 50 things done (`purrlor audit 200` for more): time, who, what, the
target, the result and the reason. The file is only ever appended to, and the service never rewrites
it.

## Files

All in the token server's data volume (`/data`, root-only like the socket); see
`docs/admin-control.md` for what each holds: `hidden-pages.txt`, `public-off.txt`,
`blocked-media.txt`, `media-deletions.json` and `audit.log`. The lists can be read and in a pinch
edited by hand; the service notices within ten seconds.

## Setting up and when it doesn't work

`deploy/setup.sh` creates the socket's directory (`/run/purrlor`, or `PURRLOR_CONTROL_DIR` in
`.env`) owned by root with mode `0700`, and a `tmpfiles.d` entry so it is there again after a
reboot. The token server makes the socket itself `0600` each time it starts.

- **"Couldn't talk to the control socket":** the token server isn't running (`purrlor status`), or
  `CONTROL_SOCKET` in its environment is empty. Its log says `Admin control socket not started: …`
  with the reason, such as the directory being a symlink or owned by someone else.
- **"Refusing: … is a symlink" or "… is open to other users":** something changed the socket's
  directory. `purrlor restart token-server` makes it private again; find out what changed it first.
  The directory must also hold nothing but the socket, or setup and the token server refuse it.
- **Keeping the audit log beyond reach of the service:** the service only ever appends to it, but
  a compromised token server could still rewrite its own data volume. For a log even that can't
  touch, `chattr +a` the file on the host (in the `token-server-data` volume's folder under
  `/var/lib/docker/volumes/`); appending keeps working.
- **"needs root":** run it with `sudo`.
- **A command asks for a reason but you're in a script:** pass `--reason` and `--yes`.

## Tests

`bash deploy/test/purrlor-control.test.sh` checks the shell commands against a stand-in for `curl`:
what they send, that a hostile reason or name never changes the request, that the admin password
never reaches a command line, and that nothing is sent without a reason and a confirmation. The
service side is tested in `services/token-server/src/control.test.ts` and `controlServer.test.ts`.
