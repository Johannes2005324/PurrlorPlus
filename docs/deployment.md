# Deploying your own Purrlor server

## The quick way

On a fresh server, as root. **Alpine** (3.20 or newer):

```sh
wget -qO- https://raw.githubusercontent.com/m0nnnna/Purrlor/master/install.sh | sh
```

**Debian 12 / Ubuntu 22.04 or 24.04:**

```sh
curl -fsSL https://raw.githubusercontent.com/m0nnnna/Purrlor/master/install.sh | sudo sh
```

On Alpine it uses `apk` and OpenRC: it installs Docker from Alpine's own packages (switching on the
community repository if it's off), starts Docker, nginx and cron at boot, writes nginx's config to
`/etc/nginx/http.d/`, and renews certificates from a daily cron job
(`/etc/periodic/daily/purrlor-certbot-renew`), since Alpine has no systemd timers. The manual steps
below are written for Debian/Ubuntu; on Alpine, read `apk add` for `apt install` and
`rc-service <name> <action>` for `systemctl <action> <name>`.

That clones Purrlor into `/opt/purrlor` and runs the guided installer (`deploy/setup.sh`, described
under "The guided script" below). It asks a few questions, shows you the DNS records to create and
waits for them, then installs and starts everything — a homeserver with your admin account, HTTPS,
voice, push — and checks the result from the outside. Afterwards, `purrlor` manages it (see
"Maintaining a running deployment"). Most people need nothing else on this page.

The rest of this guide is the same install done by hand, step by step: what each piece is for,
and how to run it when the installer's assumptions don't fit (your own homeserver, nginx on a
separate machine).

## Scope — what this is (and isn't)

Purrlor is a **Matrix client**, not a homeserver — but `deploy/setup.sh` provisions one for you by
default. There are two ways to go:

- **Option A — bring your own homeserver.** This is what the rest of this guide (Steps 1–10)
  walks through: you already have a Matrix homeserver (Synapse, Dendrite, Conduit, whatever —
  anything with a working Client-Server API) and just want Purrlor's own services stood up
  alongside it. If you don't have a homeserver yet and want to run one yourself long-term,
  [Synapse's own install docs](https://element-hq.github.io/synapse/latest/setup/installation.html)
  are the standard starting point — set that up first, then come back here.
- **Option B — let the script provision one too (the default).** If you don't have a homeserver
  and don't want to set one up by hand, `deploy/setup.sh` spins up
  [Continuwuity](https://continuwuity.org/) (a lightweight, spec-compliant, federation-capable
  Rust homeserver — no separate database service to run) as part of the same guided setup,
  including **automatically creating both your own account and the token server's bot account**
  via the registration API — no manual Matrix account creation, no copying access tokens by hand.
  This needs two things Option A doesn't: one extra DNS record (the bare apex domain, for
  `.well-known` federation delegation) and one extra open port (**8448/tcp**, federation). The
  script asks which option you want right after the initial domain prompts and handles either
  path from there — everything below Step 4 in this guide is unaffected either way, since the
  token server just takes a homeserver URL + bot credentials and doesn't care which homeserver
  software is actually behind them. It also asks who may sign up:
  - **Invite-only** (the default): sign-up needs `MATRIX_REGISTRATION_TOKEN`, which the script
    prints at the end for you to hand out. Purrlor's register screen asks for it. Optionally,
    new accounts also have to confirm an email address.
  - **By email**: anyone who confirms an email address (from a link the homeserver sends) can
    sign up, no code needed. Needs a mail server to send from. Switch between this and "code plus
    email" any time with `purrlor email codes off` / `purrlor email codes on`.
  - **Closed**: nobody but you and the voice bot. Create accounts later from the admin room
    (`!admin users create-user <name>`), or reopen sign-up with `MATRIX_ALLOW_REGISTRATION=true`.

Either way, the script can **lock the web client to that homeserver** (`PURRLOR_HOMESERVER_URL`):
the login and register screens then show the server's name instead of a homeserver field. It's
read when the `web` container starts, so changing it only needs `docker compose ... up -d web`,
not a rebuild.

Either way, this guide assumes you have:

- **A domain name you control the DNS for.**
- **A VPS** (or any always-on Linux box with a public IP) to run Purrlor's own services on (and,
  with Option B, the new homeserver too). This can be the same machine as an existing homeserver
  or a different one — they don't need to be co-located, they just both need to be reachable over
  HTTPS.

What you're deploying on that VPS is four small services, all defined in
`deploy/docker-compose.yml`:

| Service        | What it does                                             | Talks to the internet as |
|----------------|-----------------------------------------------------------|---------------------------|
| `web`          | The Purrlor client itself (the thing people open in a browser) | `app.YOUR_DOMAIN` |
| `livekit`      | Voice/video call media server                              | `livekit.YOUR_DOMAIN` |
| `token-server` | Issues LiveKit call tokens, gated by Matrix room membership/power level | `app.YOUR_DOMAIN/api/livekit/` |
| `push-gateway` | Turns Matrix push notifications into real Web Push, for notifications when no tab is open | `app.YOUR_DOMAIN/api/push/` |

So there are only two names to point at the server: `app.` and `livekit.`. Neither should collide
with your homeserver's own domain (often `matrix.YOUR_DOMAIN`) — they're separate services. (Older
versions of this guide gave the token server and push gateway their own `token.` and `push.`
subdomains; that still works if you'd rather — `deploy/nginx/token.nginx.conf.example` and
`push.nginx.conf.example` show it.) If you skip voice/video and background push entirely, you only
need `app.YOUR_DOMAIN` and can drop `livekit`, `token-server`, and `push-gateway` from the compose
file and the nginx config below.

## Prerequisites checklist

- [ ] A VPS running Ubuntu 22.04/24.04 (or Debian — the commands below are `apt`-based; adapt for
      another distro). 1 vCPU / 1-2 GB RAM is plenty unless you expect a lot of concurrent voice
      calls.
- [ ] Root or sudo access on it.
- [ ] A domain, with the ability to add DNS records.
- [ ] **Option A only:** your existing homeserver's URL and an account on it you can use to create
      a dedicated bot account (see Step 4). **Option B only:** nothing extra here — the script
      creates both the bot account and your own account for you.
- [ ] Ports **80/tcp**, **443/tcp**, **7881/tcp**, and **7882/udp** reachable from the internet
      on the VPS (check your provider's firewall/security-group settings, not just the OS
      firewall — cloud providers often filter inbound traffic separately). The first two are
      normal HTTPS; the last two are LiveKit's WebRTC media ports and can't be proxied through
      nginx like everything else — real-time media has to reach the box directly. **Option B
      also needs 8448/tcp** (Matrix federation).

## Step 1 — DNS

Point two A records at your VPS's public IP:

```
app.YOUR_DOMAIN      ->  <VPS IP>
livekit.YOUR_DOMAIN   ->  <VPS IP>
```

**Option B (bundled homeserver) needs one or two more**: a `matrix.` subdomain (the homeserver
itself), and — only if you want addresses like `@name:YOUR_DOMAIN` rather than
`@name:matrix.YOUR_DOMAIN` — the bare domain too, for `.well-known` delegation. Pointing the bare
domain here replaces any website on it; the installer asks, and defaults to leaving it alone when
it already points somewhere else.

```
matrix.YOUR_DOMAIN    ->  <VPS IP>
YOUR_DOMAIN           ->  <VPS IP>     (only for @name:YOUR_DOMAIN addresses)
```

If the domain is on Cloudflare, set these records to **DNS only** (grey cloud): voice and video
can't pass through Cloudflare's proxy. And don't leave an AAAA (IPv6) record pointing somewhere
else — Let's Encrypt prefers IPv6 and fails the certificate if it lands on the wrong machine.

DNS propagation can take a few minutes to a few hours depending on your registrar/TTLs — the
certbot step below will fail with a timeout if it runs before records have propagated, so it's
worth confirming first: `dig +short app.YOUR_DOMAIN` from your own machine should return the VPS
IP for every name above before you continue.

## Step 2 — Install Docker and Docker Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out/in (or `newgrp docker`) for this to take effect
```

Docker's install script pulls in the Compose plugin (`docker compose`, no hyphen) automatically.
Confirm with `docker compose version`.

## Step 3 — Get the repo onto the VPS

```bash
git clone https://github.com/YOUR_FORK/purrlor.git
cd purrlor
```

(Or `scp`/rsync it over if you're not using git on the VPS. Either way, everything from here on
assumes your working directory is the repo root.)

## Step 4 — Create the token server's bot account

**Skip this step entirely if you're using Option B** — the guided script registers this account
for you automatically (along with your own), against the homeserver it just provisioned. This
step is for Option A (bringing your own homeserver) only.

The token server (`services/token-server`) uses one dedicated Matrix account to check room
membership and power levels before handing out LiveKit tokens — see
[`docs/voice-architecture.md`](voice-architecture.md) for why. Create this account on your
**existing homeserver** (not something Purrlor's stack sets up):

**Via Element, Cinny, or any other client:** register a new account, e.g.
`@purrlor-voice-bot:YOUR_DOMAIN`, the ordinary way. Then get a long-lived access token for it —
in Element: Settings → Help & About → Advanced → Access Token. Copy it somewhere safe; you'll
paste it into `.env` in Step 6. This is the easiest path if registration on your homeserver
allows it.

**Via the API instead**, if your homeserver has open registration:

```bash
curl -s https://YOUR_HOMESERVER/_matrix/client/v3/register \
  -d '{"username":"purrlor-voice-bot","password":"<a strong password>","auth":{"type":"m.login.dummy"}}'
```

This returns an `access_token` directly in the response — no separate login step needed. If
registration requires a captcha, email verification, or a registration token on your homeserver,
register through whatever flow it actually requires instead, then log in to get a token:

```bash
curl -s https://YOUR_HOMESERVER/_matrix/client/v3/login \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"purrlor-voice-bot"},"password":"<password>"}'
```

Either way you should end up with:
- `MATRIX_BOT_USER_ID` — the full `@purrlor-voice-bot:YOUR_DOMAIN` (the `user_id` field)
- `MATRIX_BOT_ACCESS_TOKEN` — the `access_token` field

Sanity-check the token before moving on:

```bash
curl -s https://YOUR_HOMESERVER/_matrix/client/v3/account/whoami \
  -H "Authorization: Bearer <the access token>"
# should echo back {"user_id":"@purrlor-voice-bot:YOUR_DOMAIN"}
```

This bot only ever needs to be **invited** into rooms you want voice-gated, and the app does that
for you: it publishes its own user ID at `GET /api/livekit/config`, the Space Settings form picks
that up when you enter the token endpoint, and from there new voice channels invite it at
creation while older ones invite it the first time someone joins the call (see
[`docs/voice-architecture.md`](voice-architecture.md)'s "Service bot membership"). It auto-joins
on invite — `services/token-server/src/membership.ts`.

It never needs admin rights, and it never reads encrypted message content, only room membership
and power levels, which Matrix never encrypts.

## Step 5 — Generate the stack's own secrets

```bash
# LiveKit's API key/secret pair — shared between the livekit and token-server services.
openssl rand -hex 16   # -> LIVEKIT_API_KEY
openssl rand -hex 16   # -> LIVEKIT_API_SECRET

# Web Push's VAPID key pair — no host Node.js install needed, borrow a throwaway container:
docker run --rm node:22-alpine npx --yes web-push generate-vapid-keys --json
```

## Step 6 — Write `.env`

```bash
cp .env.example .env
```

Fill in every value `.env.example` calls out, using what you generated above:

- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — from Step 5
- `HOST_IP` — the VPS's public IP (`curl -4 ifconfig.me` prints it)
- `ALLOWED_ORIGINS` — `https://app.YOUR_DOMAIN`
- `MATRIX_HOMESERVER_URL` — your existing homeserver's URL, e.g. `https://matrix.YOUR_DOMAIN`
- `MATRIX_BOT_USER_ID` / `MATRIX_BOT_ACCESS_TOKEN` — from Step 4
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — from Step 5
- `VAPID_SUBJECT` — `mailto:you@YOUR_DOMAIN` (a real address the push service can contact if
  something's wrong with this deployment)
- `PURRLOR_HOMESERVER_URL` — optional: your homeserver's URL, to lock the web client to it
- `PURRLOR_LIVEKIT_URL` — `wss://livekit.YOUR_DOMAIN`
- `PURRLOR_TOKEN_ENDPOINT` — `https://app.YOUR_DOMAIN/api/livekit/token`
- `PURRLOR_PUSH_GATEWAY_URL` — `https://app.YOUR_DOMAIN/api/push`

The last three are what let the app set up voice and notifications by itself (Step 10). Leave
them out and people configure both by hand in the app instead.

Optional, for an Android app built for this server (`apps/android/README.md`):
`PURRLOR_ANDROID_PACKAGE` (its package name) and `PURRLOR_ANDROID_CERT_SHA256` (the SHA-256
fingerprints of its signing keys, comma-separated). The web container serves them as
`/.well-known/assetlinks.json`, which lets the app open the site full screen.

Leave `VOICE_MODERATOR_POWER_LEVEL` at its default unless you specifically want a different
threshold.

Leave `VOICE_ALLOWED_SPACES` unset unless registration on your homeserver is open. Unset, the
voice bot serves every space on your own homeserver it gets invited into — which the app does
for you when a space admin saves that space's voice settings — and ignores everything else,
including any invite from a federated server. Setting it to a comma-separated list of space room
IDs narrows that to exactly those spaces. See `docs/voice-architecture.md`'s "Which rooms a
deployment serves" for what each gate actually checks.

## Step 7 — TLS certificates

```bash
sudo apt update && sudo apt install -y certbot
sudo systemctl stop nginx 2>/dev/null   # free up port 80 if nginx is already installed/running

sudo certbot certonly --standalone \
  -d app.YOUR_DOMAIN -d livekit.YOUR_DOMAIN \
  --agree-tos -m you@YOUR_DOMAIN --no-eff-email
```

This gets you one certificate covering both names (add `-d` for any others you need, e.g. the
homeserver's), at
`/etc/letsencrypt/live/app.YOUR_DOMAIN/{fullchain,privkey}.pem`. `--standalone` briefly binds
port 80 itself to answer the ACME challenge, which is why nginx needs to be stopped (or not yet
installed) first.

Set up auto-renewal with an nginx reload so renewed certs actually get picked up (certbot
installs a systemd timer automatically; this just adds the reload):

```bash
echo '#!/bin/sh
systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run   # confirms the whole renewal path works, changes nothing
```

## Step 8 — nginx reverse proxy

```bash
sudo apt install -y nginx
```

Copy `deploy/nginx/nginx-proxy.conf.example` to `/etc/nginx/sites-available/purrlor.conf`,
replace every `YOUR_DOMAIN`, and point the two `ssl_certificate*` paths at the cert from Step 7
(`/etc/letsencrypt/live/app.YOUR_DOMAIN/fullchain.pem` and `.../privkey.pem` — the same pair in
every server block, since it's one multi-domain cert):

```bash
sudo cp deploy/nginx/nginx-proxy.conf.example /etc/nginx/sites-available/purrlor.conf
sudo sed -i 's/YOUR_DOMAIN/your-actual-domain.com/g' /etc/nginx/sites-available/purrlor.conf
sudo sed -i 's#/path/to/ssl/fullchain.pem#/etc/letsencrypt/live/app.your-actual-domain.com/fullchain.pem#g; s#/path/to/ssl/privkey.pem#/etc/letsencrypt/live/app.your-actual-domain.com/privkey.pem#g' /etc/nginx/sites-available/purrlor.conf
sudo ln -s /etc/nginx/sites-available/purrlor.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

(`deploy/nginx/livekit.nginx.conf.example` is the LiveKit block on its own, if you keep one vhost
file per service. `token.nginx.conf.example` and `push.nginx.conf.example` are the older layout
with their own subdomains — use those only if you set the `PURRLOR_*` URLs in `.env` to match.)

## Step 9 — Bring the stack up

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

Check everything actually started:

```bash
docker compose -f deploy/docker-compose.yml ps
curl -s http://127.0.0.1:3001/health   # token server
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080   # web client, expect 200
```

## Step 10 — Voice and notifications in the app

With `PURRLOR_LIVEKIT_URL`, `PURRLOR_TOKEN_ENDPOINT` and `PURRLOR_PUSH_GATEWAY_URL` set (Step 6),
there's nothing to do here:

- **Voice** — the first time a Space's admin opens a Space created on this homeserver, the app
  gives it this deployment's voice server and invites the token server's bot, exactly as saving
  Space Settings → General by hand would. A Space where an admin has turned voice off (cleared
  those fields) is left alone, as is a Space from another homeserver, which this token server
  can't serve.
- **Notifications** — Account Settings → Notifications already has the push gateway filled in;
  turning background notifications on is one switch.

Without them, set both by hand: in **Space Settings → General**, the LiveKit URL
(`wss://livekit.YOUR_DOMAIN`) and token endpoint (`https://app.YOUR_DOMAIN/api/livekit/token` —
the full path, not just the host); the **Voice service account** fills itself in from the token
server once you leave that field. And in **Account Settings → Notifications**, the push gateway
(`https://app.YOUR_DOMAIN/api/push`).

Then log into `https://app.YOUR_DOMAIN`, create a voice channel, and join it.

## The guided script

`deploy/setup.sh` does all of the above, Steps 1–10: the one-line installer at the top of this
page downloads Purrlor and runs it. From a checkout you already have, run it as root from the
repo root:

```bash
sudo bash deploy/setup.sh
```

In order, it:

1. **Checks the server** — adds a swap file if there's too little memory to build the web client
   (the usual reason a small VPS "fails for no reason" mid-build), and stops early if disk space is
   short or something other than nginx already holds ports 80/443.
2. **Asks** whether this host needs an outbound proxy (see "Outbound proxy"), your domain, the
   app's and voice server's addresses, whether to add the TURN relay, the server's public IP
   (detected for you), and your email.
3. **Asks about the homeserver** — provision one (Option B, the default) or use yours (Option A).
   For Option B: whether addresses should read `@name:YOUR_DOMAIN` (the bare domain points here
   too) or `@name:matrix.YOUR_DOMAIN` (the bare domain is left alone — the default when it already
   points somewhere else, like an existing website), and who may sign up (invite-only with a
   sign-up code, anyone who confirms an email address, or closed).
4. **Walks you through DNS** — lists exactly which records to create, then checks them, again
   whenever you press Enter, until they all point here (catching a stray AAAA record too).
5. **Installs** Docker, nginx and certbot if they're missing; generates every secret; writes
   `.env`, including the `PURRLOR_*` URLs that make voice and push work without in-app setup.
6. **Gets a certificate** covering every name (re-issuing if a re-run needs a name the old one
   lacks), writes and enables the nginx config, and opens the firewall if `ufw` is active.
7. **Starts everything.** For Option B it starts the homeserver first and creates your account
   (the first, so the admin) and the token server's bot account through the registration API —
   the bot's password is generated and never shown; only its access token lands in `.env`.
8. **Checks it from the outside** — the app, the token server, the push gateway, the voice
   server, the homeserver and federation, each fetched over HTTPS at its real address — then
   prints a summary (saved; `purrlor info` shows it again) and installs the `purrlor` command.

It assumes the standard single-host layout (nginx and the stack on the same box); for the split
topology below, follow the manual steps. Safe to re-run: it asks before overwriting `.env`
(keeping it keeps every secret and account and only updates what you just answered), skips
accounts that already exist, and reuses the certificate when it still covers everything.

## Outbound proxy (optional)

Any HTTP(S) forward proxy works, including a [NekoProxy](https://github.com/m0nnnna/nekoproxy)
agent's (its "Forward proxy port", with `user:password@` in front of the host if you set "Forward
proxy auth"). The installer accepts `host:port` without the `http://`. A proxy on this server's
own loopback (`localhost:8080`) is fine for the server itself, but containers have their own
loopback — so the installer gives them `http://host.docker.internal:8080` instead (`CONTAINER_PROXY`
in `.env`; docker-compose.yml maps that name to the host) and checks from inside a container that
it works. For that, the proxy has to listen on more than 127.0.0.1: NekoProxy binds to the agent's
WireGuard IP when it has one — give the installer that address — or to its listen address otherwise.

For a host that can only reach the internet through an HTTP(S) proxy — a corporate egress proxy,
or one you run so this server's own IP stays out of its outgoing requests. Inbound traffic
(people loading Purrlor, other homeservers federating in, voice/video media) doesn't go through it.

The guided script asks about this first, since it needs the internet itself. Say yes and it:

- uses the proxy for its own downloads (Docker's installer, apt, certbot, the VAPID key
  generator), and checks it works by showing the address your outbound traffic appears from;
- configures the **Docker daemon** to pull images through it
  (`/etc/systemd/system/docker.service.d/purrlor-proxy.conf` — restarting Docker, after asking, if
  other containers are running);
- configures **certbot's renewal service** the same way — otherwise renewals can't reach Let's
  Encrypt and certificates quietly expire;
- writes `OUTBOUND_PROXY` / `OUTBOUND_NO_PROXY` into `.env`, which `docker-compose.yml` hands to
  the services that make outbound requests and to their image builds (npm):

| Service        | Outbound requests it makes |
|----------------|----------------------------|
| `matrix`       | Federation with other homeservers |
| `push-gateway` | Delivery to browser push services (FCM, Mozilla, Apple) |
| `token-server` | OpenID checks against the homeservers of people joining calls |

`livekit` and `web` make none. The Node services honor the variables through
`NODE_USE_ENV_PROXY=1` (Node 22.21+); Continuwuity honors them natively.

A few things to know:

- **The proxy must be reachable from containers.** `127.0.0.1` inside a container is the
  container itself — use the host's LAN address, or the Docker bridge address (usually
  `172.17.0.1`) with the proxy listening there.
- **Keep the in-stack names in `OUTBOUND_NO_PROXY`** (`livekit`, `token-server`, `push-gateway`,
  `web`, `matrix`, plus loopback). The script's default does; without them the token server
  would send its calls to LiveKit and the homeserver to the proxy.
- **HTTP(S) proxies only.** SOCKS isn't supported by Node's proxy support.
- **DNS.** The `matrix` container resolves names through `matrix-resolv.conf`, which `purrlor`
  writes before every start: this server's own DNS servers first (from `/etc/resolv.conf`, or
  systemd-resolved's upstreams), then 1.1.1.1 as a fallback. So a name only your local network
  knows, like a mail server on the LAN, resolves there too.

## Variant: split edge-proxy + origin topology

**The installer does this for you:** at "Where should nginx run?", pick "On another server I
already run". It then skips nginx and certificates on this server, asks for this server's private
address (offering its WireGuard/LAN addresses) and sets `BIND_ADDR` and `PURRLOR_EDGE=true`,
accepts DNS records that point at the edge (or at Cloudflare), and writes two files for the edge
box into `deploy/edge/`: `purrlor.conf` (the sites, proxying to the private address) and
the optional `voice-relay.stream` (the voice/video relay, only when the edge box itself receives
ports 7881/7882 — named `.stream` so no `*.conf` include picks it up, which would make nginx refuse
the whole reload), with where each goes. `purrlor doctor` then checks
through the edge. The rest of this section is what that amounts to, by hand.

Everything above assumes nginx and the docker-compose stack run on the same box. A common
alternative, especially if the actual app server sits behind Cloudflare and isn't meant to be
directly reachable: a small **edge box** with a public IP holds the TLS certs and nginx, and
proxies everything through a private network (typically a WireGuard tunnel) to an **origin box**
that runs `deploy/docker-compose.yml` and is never exposed to the internet directly.

What changes from the single-host guide:

- **DNS and certs (Steps 1, 7)** still point at the edge box's public IP and run there —
  unchanged.
- **The docker-compose stack (Step 9)** runs on the *origin* box instead, with `BIND_ADDR` in
  `.env` set to the origin's address on the private network (e.g. its WireGuard interface IP,
  `10.40.40.2`) instead of the default `127.0.0.1` — otherwise the edge box has no way to reach
  these ports at all. Never set it to `0.0.0.0`; these ports have no TLS or auth of their own,
  only the private network's own access control stands between them and anyone who can reach the
  origin box.
- **nginx's `location`/`proxy_pass` targets (Step 8)**, on the edge box, change from
  `127.0.0.1:<port>` to `10.40.40.2:<port>` (the origin's private address) for the four HTTP-ish
  ports (`8080` web, `3001` token server, `3002` push gateway, `7880` LiveKit signaling).
- **LiveKit's two raw media ports (`7881/tcp`, `7882/udp`) need a separate relay.** They carry
  WebRTC media, not HTTP, so an ordinary `location` block can't proxy them — that only works
  inside nginx's `http {}` context, and these aren't HTTP traffic. `deploy/nginx/stream-livekit.nginx.conf.example`
  relays them using nginx's `stream {}` context instead (a sibling of `http {}`, not nested in
  it) — copy it to the edge box, replace the origin address, and confirm the stream module is
  actually available first:

  ```bash
  nginx -V 2>&1 | grep -o with-stream
  ```

  If that prints nothing, your nginx build doesn't have it — on Debian/Ubuntu, `apt install
  nginx-full` (or `nginx-extras`) instead of the base `nginx` package usually provides it; a
  dynamic-module build instead needs `load_module modules/ngx_stream_module.so;` added at the
  very top of `/etc/nginx/nginx.conf`, before any `http {}`/`stream {}` block.

- **If you're replacing an existing setup that already has this working** (e.g. an old
  cinny-voice deployment using the same edge box and domains): the certs and DNS likely don't
  need to change at all — only the `proxy_pass`/`stream` targets, once they're pointed at the new
  origin's private address, and the `.env` on the new origin box. Check what's already in
  `/etc/nginx/sites-enabled/` and any existing `stream {}` config on the edge box before writing
  new files — updating the existing ones in place is usually less error-prone than adding a
  second, parallel config for the same domains.

## TURN relay (optional IP-hiding hardening)

`deploy/livekit.yaml` ships with a commented-out `turn:` block for relaying voice/video media
through a TURN server — useful if you want to hide the VPS's IP from call participants, or work
around a particularly hostile network. Not needed for a normal deployment. The guided script asks
about this right after the LiveKit subdomain prompt ("Hide this server's IP behind a TURN
relay...?") — say yes and it handles everything: one more DNS record (`turn.YOUR_DOMAIN`, included
automatically in the same certificate as everything else), copying the TLS cert into
`deploy/livekit-certs/` (gitignored — real key material, never committed) with a renewal hook that
refreshes it and restarts `livekit` automatically, and rewriting `deploy/livekit.yaml` with the
`turn:` block filled in. Doing this by hand instead means: add the DNS record yourself, add
`turn.YOUR_DOMAIN` to the certbot `-d` list in Step 7, copy the resulting cert into
`deploy/livekit-certs/{fullchain,privkey}.pem`, and uncomment/fill in `livekit.yaml`'s `turn:`
block yourself (`tls_port: 5349`, not 443 — this same host's nginx already owns 443).

Either way, this needs two more ports open at your provider's firewall/security-group level:
**5349/tcp** and **3478/udp**.

Note this doesn't disguise TURN traffic as ordinary HTTPS on port 443 the way a from-scratch setup
on a dedicated host could — nginx already owns 443 here for the four proxied services, so TURN
runs on the standard 5349 TURNS port instead, distinguishable by port number to anyone actually
looking. Still hides the origin IP behind the TURN relay's own IP, which is the main goal.

## Troubleshooting

- **Voice call connects but no audio/video, or only works between two people on the same
  network.** Almost always port 7882/udp (or 7881/tcp for privacy browsers that block UDP) not
  actually reaching the VPS — recheck your cloud provider's firewall/security group, not just
  `ufw`/`iptables` on the box itself. See "TURN relay" above if you want to hide the VPS's IP or
  work around a particularly hostile network; not needed for a normal deployment.
- **Token server rejects everyone ("not a member" or similar).** The bot account from Step 4
  needs to actually be *invited into* the room/Space, not just have an account — it can't read
  membership for rooms it hasn't joined.
- **(Option B) Other homeservers can't find yours / federation doesn't work.** Confirm
  `https://YOUR_DOMAIN/.well-known/matrix/server` actually returns
  `{"m.server": "matrix.YOUR_DOMAIN:443"}` from a browser or `curl` — if it doesn't, the bare
  apex domain's DNS record or nginx block is missing (see Step 1 and the guided script's nginx
  output). Also double check port **8448/tcp** is actually open at the provider firewall level,
  not just the OS firewall — this is the single most common miss, since it's easy to open 80/443
  and forget the federation port entirely.
- **Start with `purrlor doctor`.** It checks DNS, HTTPS, each service and the certificate from
  the outside, and says which part is failing.
- **CORS errors in the browser console calling the token server or push gateway.** `.env`'s
  `ALLOWED_ORIGINS` doesn't match the origin you're actually loading the app from — it has to be
  the exact scheme+host the browser bar shows (`https://app.YOUR_DOMAIN`, not `www.` or a bare
  IP).
- **Push notifications never arrive when no tab is open.** Check `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` in `.env` match the pair the push gateway was actually started with (a
  regenerated pair after the gateway's first run invalidates every existing subscription — see
  [`docs/push-notifications.md`](push-notifications.md)), and that the push gateway URL entered
  in Account Settings is reachable and correct.
- **`certbot certonly --standalone` times out or fails the challenge.** Almost always one of:
  DNS hasn't propagated yet (recheck with `dig`), port 80 is still bound by something else (`sudo
  lsof -i :80`), or the cloud firewall/security group blocks inbound port 80.
- **Let's Encrypt rate limits.** If you're testing repeatedly, add `--dry-run` to the `certbot
  certonly` command first, or use `--staging` to get a real (untrusted) cert without touching
  your production rate limit while you iterate on everything else.

## Maintaining a running deployment

The installer links a `purrlor` command into `/usr/local/bin`:

- **`purrlor update`** — `git pull`, rebuild what changed, restart onto it, and clear out the old
  images. (By hand: `git pull`, then `docker compose -f deploy/docker-compose.yml --env-file .env
  up -d --build`, adding `--profile matrix` with the bundled homeserver.)
- **`purrlor status`** / **`purrlor doctor`** — what's running, from the inside and the outside.
- **`purrlor logs [service]`** — `livekit`, `token-server`, `push-gateway`, `web`, or — with the
  bundled homeserver — `matrix`.
- **`purrlor backup`**, **`purrlor restore`** — see [Backups](#backups) below.
- **`purrlor alerts <url>`** — see [Alerts](#alerts) below.
- **`purrlor new-invite-code`**, **`open-signups`**, **`close-signups`** — who can join the bundled
  homeserver.
- **`purrlor media`** — where the bundled homeserver keeps uploads (usually most of the disk space
  it uses), and how much room they take. **`purrlor media move /path/to/dir`** moves them to
  another folder or disk (it checks there's room, copies and verifies with the homeserver
  stopped, then offers to delete the old copy); **`purrlor media move default`** puts them back in
  Docker's storage. The folder is `MATRIX_MEDIA_DIR` in `.env` — change it only with `media move`,
  which is what actually moves the files. `purrlor backup` includes the media wherever it is.
- **`purrlor user ...`** / **`purrlor admin <command>`** — manage accounts on the bundled
  homeserver (list, reset a password, deactivate, change an email) without the admin room.
- **Cert renewal** is automatic via certbot's systemd timer (`systemctl list-timers | grep
  certbot`) plus the nginx reload hook — nothing to do unless `certbot renew --dry-run` ever stops
  succeeding.
- **What to back up:** everything `purrlor backup` saves (below), and `/etc/letsencrypt` if you'd
  rather not re-issue certificates after a rebuild. Everything else rebuilds from the repo.

### Backups

**`sudo purrlor backup [dir]`** saves everything a rebuilt server needs that git doesn't have, in
one file (default folder: `backups/` in the install). That covers:

- the settings (`.env`), the homeserver's mail settings and the install summary
- the bundled homeserver's data: accounts, rooms, messages and every upload, wherever `purrlor
  media move` put them
- the token server's moderation records: hidden and switched-off pages, takedowns, queued
  deletions and the audit log
- the push gateway's scheduled reminders

The homeserver, token server and push gateway stop together while it copies, so what they hold
agrees. That takes seconds, or a minute or two with a lot of media. The file holds your secrets,
so it's readable by root only. `purrlor backup list` shows the ones saved here.

**Nightly backups:** `sudo purrlor backup schedule daily [N]` makes one every night (03:30; 02:00 on
Alpine) and keeps the newest N (default 7). Backups you make by hand are never cleared out.
`purrlor backup schedule` says whether they're on, and `... schedule off` stops them. They need cron running
(Debian/Ubuntu: `apt-get install cron` if it's missing; Alpine: `rc-update add crond`). Each night's output
goes to `/var/log/purrlor.log`.

**A copy somewhere else:** a backup on the server it protects doesn't survive losing that server.
`sudo purrlor backup copy-to user@host:/path` copies each nightly backup there too, over SSH as root
with a key, no password. A Hetzner Storage Box, rsync.net or any server you can SSH to works. It
checks it can copy before saving the setting, and says how to set up the key if it can't. Old
copies on the other side aren't deleted: clear them there, or let its snapshots do it.
`... copy-to off` stops copying.

**Restoring:** `sudo purrlor restore <file>` puts a backup back. It shows what the backup holds and
asks you to confirm (or pass `--yes`). Then it:

1. saves how things are now as a `before-restore` backup, so you can go back
2. stops Purrlor and puts the settings back
3. puts the homeserver's, token server's and push gateway's data back, replacing what's there
4. starts everything and checks it answers

A few settings describe the machine rather than the install, so the server's own values are kept:
`HOST_IP`, `BIND_ADDR`, `MATRIX_MEDIA_DIR` (media goes wherever this server keeps it),
`PURRLOR_CONTROL_DIR`, the proxy settings, `PURRLOR_EDGE`, `REAL_IP_FROM`, and the alert and backup
settings below. A backup from before these were all included (no moderation records or reminders)
restores what it has and leaves this server's records alone.

**Moving to a new server, or rebuilding one:** clone the repo and run `deploy/setup.sh` on it with
the same domains, so nginx, certificates and Docker are set up. Then copy a backup over and run
`sudo purrlor restore <file>`. Point DNS at the new server once it answers (`purrlor doctor`).

**Practise it.** A backup you've never restored is a guess. Restoring the newest backup onto a
spare server now and then, as above, is the only way to know it works.

### Federating with other Purrlor instances

`sudo purrlor peers add <its address>` shares the social side with another Purrlor instance: its
people's Global posts and pages, and its public Spaces, show here in Everyone, Discover and (for
people who opted in) the public web. Each side adds the other. `purrlor peers` lists them and what
this server's bot reads there, and `purrlor peers remove <server name>` stops it.
[`docs/federation.md`](federation.md) has how it works and what it shows. Optional settings in
`.env`: `PURRLOR_INSTANCE_NAME` (what peers call this instance), `PEER_MAX_PROFILES`,
`PEER_MAX_SPACES`, and `PEER_SPACE_FEEDS=off` to read peers' Global posts only.

The bundled homeserver serves its room directory over federation so peers can read it
(`MATRIX_DIRECTORY_OVER_FEDERATION=false` in `.env` turns that off, and federation's Everyone and
Discover with it). With a homeserver of your own, turn it on there (Synapse:
`allow_public_rooms_over_federation: true`). `node deploy/federation-check.mjs` checks, between two
real servers, the homeserver behaviour federation needs (see the top of the file for how to run it).

### Alerts

**`sudo purrlor alerts <url>`** checks the server every 5 minutes (15 on Alpine) and sends a message
when something goes wrong, and again when it's fine:

- a service not answering: the web app, token server, push gateway, LiveKit, or the homeserver
- a disk over 90% full: Docker's, the media folder's, or the backups'
- the HTTPS certificate running out within 14 days (where nginx runs on this server)
- a nightly backup that failed, didn't happen for a day and a half, or couldn't be copied off
- errors (below): a service that crashed, one logging 5 or more in 15 minutes, or 30 or more from
  people's browsers in 15 minutes

Each problem is reported once, not every 5 minutes. A service stopped on purpose by a backup or
restore isn't reported as down. The URL can be:

- **ntfy** (`https://ntfy.sh/<a long random topic>`, or your own ntfy server): alerts on your phone
  through the ntfy app, with nothing to set up. Anyone who knows the topic name can read it, so
  make it long and random.
- **A Discord, Slack or Purrlor channel webhook.** A Purrlor webhook is no help when Purrlor itself
  is down, so use it for disks and backups, not as the only place alerts go.
- **Anything that takes a POSTed text body.**

It sends a first message before turning on, so a wrong URL is caught straight away.
`purrlor alerts` shows the setting and what was wrong at the last check, `... alerts test` sends a
test, and `... alerts off` stops it.

### Errors and metrics

**`sudo purrlor errors`** lists what's gone wrong, newest first: in the token server and push gateway
(everything they log as an error, and a crash), and in people's browsers. Repeats are grouped, so each
kind is listed once, with how often it happened, when it was first and last seen, the kind of page,
the build, and the start of its stack. `... errors web` lists only the browsers' errors, `... errors
server` only the services' own, and `... errors clear` forgets them all once what caused them is
fixed. They're kept in each service's data volume (`errors.json`, at most 200 kinds), so they survive
restarts and are in backups.

The app reports an error it hits to this server's token server (`POST /api/public/client-errors`,
`apps/web/src/app/errorReporting.ts`): the message, the stack, the kind of page (`/:user/post/:id`,
never the names or IDs in it) and the build. Not who it happened to, and nothing goes to anyone else.
Network trouble, cancelled requests and browser extensions are left out, each error is sent once per
page load, at most 10, and the server limits reports per address and overall. People can turn it off
under Account Settings → Privacy. An error while drawing the app shows a "Something went wrong" page
with a Reload button instead of a blank one.

**`sudo purrlor metrics`** shows how each service is doing since it last started: uptime, memory, how
late its timers run (a busy or stuck service shows here first), requests by status, the busiest
routes with how fast they answered, voice tokens given out, accounts online, and push messages sent,
gone and failed.

For history and graphs, Prometheus can collect the same numbers from `GET /metrics` on ports 3001
and 3002; `sudo purrlor metrics prometheus` prints the scrape config. Those routes (and the ones
`purrlor errors` and `purrlor metrics` use) need `PURRLOR_METRICS_TOKEN` from `.env` as a bearer
token, since the push gateway is reachable from outside under `/api/push/`. The installer makes it, as
does `purrlor update` on an install from before it; `... metrics new-token` replaces it.

### Security headers

The web container sends its own security headers (`apps/web/deploy/security-headers.conf`), so every
setup gets them whatever proxy is in front. The one that matters most is the Content-Security-Policy:
the Matrix access token is kept in the page, and the policy is what stops a script that got into it
(through a bug, a malicious link, a hostile theme) from running. It allows:

- scripts from the app itself, WebAssembly (Matrix's encryption) and YouTube's player (watch
  parties), and nothing inline or `eval`'d
- connections, images and media to any `https` / `wss` address, since the homeserver, a Space's
  voice server, a push gateway and federated media can be anywhere
- styles and fonts from the app and Google Fonts only, which also limits what a theme's `@import`
  can load; frames from YouTube only

Alongside it: no framing by other sites (`frame-ancestors 'none'`, `X-Frame-Options: DENY`),
`nosniff`, a `Referrer-Policy` that sends other sites no more than the origin, camera, microphone and
screen sharing for this site only, and HSTS for a year on the app's own address (not its subdomains).

A homeserver or voice server reached over plain `http` is refused by the policy: put it behind HTTPS.
If you add something to the app that loads from elsewhere, add its address to the matching directive
in that file; `vite preview` serves the same file, so the end-to-end tests run under it and
`e2e/security.spec.ts` checks that nothing the app does is blocked.

Two things stay in memory in the token server, by design for a single server: the per-address rate
limits and the "online now" count. Both rebuild within minutes after a restart. Running a second
token server instance would need them in a shared store first.
