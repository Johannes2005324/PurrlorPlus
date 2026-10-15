#!/usr/bin/env bash
# Tests for the admin commands in deploy/purrlor (pages, takedown, reports, audit): what they send
# to the control socket, and what they refuse to send. A fake `curl` records its arguments and
# standard input instead of talking to a socket, and a fake `id` makes the script think it's root,
# so this runs anywhere bash does:  bash deploy/test/purrlor-control.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/repo/deploy" "$WORK/bin"
cp "$HERE/../purrlor" "$WORK/repo/deploy/purrlor"
printf 'COMPOSE_PROFILES=matrix\nMATRIX_SERVER_NAME=purr.example\n' > "$WORK/repo/.env"

# The fake curl: one argument per line in $CALLS, standard input in $STDIN (only read when an
# argument asks for it, like the real one), then a body and a status line the way `-w` prints them.
cat > "$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
[ -z "${FAKE_CURL_FAIL:-}" ] || { echo "curl: (7) Couldn't connect to server" >&2; exit "$FAKE_CURL_FAIL"; }
printf '%s\n' "$@" >> "$CALLS"
echo '--' >> "$CALLS"
for a in "$@"; do
  case "$a" in *@-) cat > "$STDIN" ;; esac
done
printf '%s\n%s' "${FAKE_BODY:-done}" "${FAKE_CODE:-200}"
FAKE
cat > "$WORK/bin/id" <<'FAKE'
#!/usr/bin/env bash
echo "${FAKE_UID:-0}"
FAKE
chmod +x "$WORK/bin/curl" "$WORK/bin/id"

export CALLS="$WORK/calls" STDIN="$WORK/stdin"
PASS=0
FAIL=0

# run ARGS... -> OUT, STATUS. Standard input is empty (not a terminal), like a script or cron job.
run() {
  : > "$CALLS"; : > "$STDIN"
  OUT="$(PATH="$WORK/bin:$PATH" SUDO_USER=tester PURRLOR_ADMIN_USER=admin PURRLOR_ADMIN_PASSWORD='p@ss w0rd&=' \
    bash "$WORK/repo/deploy/purrlor" "$@" 2>&1 < /dev/null)"
  STATUS=$?
}

ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; printf '  output: %s\n' "$OUT"; printf '  calls: %s\n' "$(tr '\n' ' ' < "$CALLS")"; }
sent() { grep -qxF -- "$1" "$CALLS"; }
check() { # check DESCRIPTION CONDITION...
  local d="$1"; shift
  if "$@"; then ok; else bad "$d"; fi
}
never_called() { [ ! -s "$CALLS" ]; }
status_is() { [ "$STATUS" -eq "$1" ]; }
status_not0() { [ "$STATUS" -ne 0 ]; }
out_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }

# --- pages ---------------------------------------------------------------------------------------

run pages hide luna --reason "reported for spam" --yes
check "hide goes to the socket" sent "--unix-socket"
check "hide uses the root-only socket path" sent "/run/purrlor/purrlor.sock"
check "hide posts to the user's hide route" sent "http://purrlor/pages/luna/hide"
check "hide carries the reason" sent "reason=reported for spam"
check "hide carries the sudo user as the actor" sent "actor=tester"
check "hide succeeds" status_is 0

run pages hide luna --yes
check "hide without a reason sends nothing" never_called
check "hide without a reason fails" status_not0
check "hide without a reason says why" out_has "reason"

run pages hide luna --reason "spam"
check "hide without --yes (no terminal) sends nothing" never_called
check "hide without --yes (no terminal) fails" status_not0

run pages off @luna:purr.example --reason "csam report" --yes
check "off goes to the public-off route" sent "http://purrlor/pages/@luna:purr.example/public-off"

run pages unhide luna
check "unhide needs no reason or confirmation" sent "http://purrlor/pages/luna/unhide"

run pages on luna
check "on goes to the public-on route" sent "http://purrlor/pages/luna/public-on"

run pages show luna
check "show is a GET with the query form" sent "-G"
check "show asks for the one user" sent "http://purrlor/pages/luna"

run pages list
check "list asks for all pages" sent "http://purrlor/pages"

# A reason is one argument, whatever is in it: nothing in it is run or split.
nasty='$(touch '"$WORK"'/pwned); `id` "quoted" & ; | > file'
run pages hide luna --reason "$nasty" --yes
check "a hostile reason arrives as one literal argument" sent "reason=$nasty"
check "a hostile reason ran nothing" test ! -e "$WORK/pwned"

# Names that could change the URL, or look like an option, are refused before anything is sent.
for name in '../x' 'a/b' 'a b' '.hidden' '' 'luna;rm' '$(id)' 'luna?x=1' 'luna%2fx' '@@luna'; do
  run pages hide "$name" --reason spam --yes
  check "refuses the name '$name'" never_called
  check "fails on the name '$name'" status_not0
done
run pages hide --reason spam --yes -- -luna
check "a name that starts with a dash is refused" never_called

run pages hide luna --bogus --reason spam --yes
check "an unknown option is refused" never_called

run pages explode luna
check "an unknown pages command is refused" never_called

# --- takedown ------------------------------------------------------------------------------------

run takedown file mxc://purr.example/abc 'https://purr.example/api/public/media/purr.example/def?width=300' --reason "dmca" --yes
check "takedown file posts to the media route" sent "http://purrlor/takedown/media"
check "takedown file sends each target" sent "target=mxc://purr.example/abc"
check "takedown file sends a pasted link as given" sent "target=https://purr.example/api/public/media/purr.example/def?width=300"
check "takedown file carries the reason" sent "reason=dmca"

run takedown file mxc://purr.example/abc 'not a file' --reason dmca --yes
check "one bad target changes nothing" never_called
run takedown file 'javascript:alert(1)' --reason dmca --yes
check "only mxc and http(s) targets are accepted" never_called
run takedown file --reason dmca --yes
check "takedown file needs a target" never_called

run takedown file mxc://purr.example/abc --yes
check "takedown without a reason sends nothing" never_called

run takedown user luna --reason "abuse" --yes
check "takedown user goes to their route" sent "http://purrlor/takedown/user/luna"

run takedown album luna 'Summer sketches' --reason "dmca" --yes
check "takedown album goes to their route" sent "http://purrlor/takedown/album/luna"
check "takedown album sends the title as one field" sent "album=Summer sketches"

run takedown album luna --reason "dmca" --yes
check "takedown album needs a title" never_called

run takedown restore mxc://purr.example/abc --reason "mistake"
check "restore needs no confirmation" sent "http://purrlor/media/unblock"

run takedown list
check "takedown list reads the block list" sent "http://purrlor/media"

run takedown run --reason "weekly clean-up" --yes
check "takedown run posts to the deletions route" sent "http://purrlor/deletions/run"
check "takedown run sends the admin account" sent "adminUser=admin"
check "takedown run reads the password from standard input" sent "adminPassword@-"
check "the password reaches curl on standard input" test "$(cat "$STDIN")" = 'p@ss w0rd&='
check "the password is on no command line" bash -c '! grep -qF -- "w0rd" "$0"' "$CALLS"

# --- reports and audit ---------------------------------------------------------------------------

run reports --pages --limit 100
check "reports posts to the reports route" sent "http://purrlor/reports"
check "reports can be narrowed to pages" sent "only=pages"
check "reports takes a limit" sent "limit=100"
check "reports mentions where copyright complaints go" out_has "Copyright complaints"

run reports --limit abc
check "a non-numeric limit is refused" never_called

run audit
check "audit is a GET with a default of 50" sent "limit=50"
run audit 20
check "audit takes a count" sent "limit=20"
run audit abc
check "audit refuses a non-number" never_called
run audit 5 6
check "audit refuses extra arguments" never_called

run bugs
check "bugs lists the last 50" sent "http://purrlor/bugs"
check "bugs lists 50 by default" sent "limit=50"
run bugs purrlor --open --limit 200
check "bugs takes a project" sent "project=purrlor"
check "bugs --open asks for open ones" sent "open=1"
check "bugs --limit takes a count" sent "limit=200"
run bugs "../x"
check "bugs refuses a project that isn't a name" never_called
run bugs resolve a1b2c3d4e5f6 --reason "fixed in 1a2b3c"
check "bugs resolve posts to the report's route" sent "http://purrlor/bugs/a1b2c3d4e5f6/resolve"
check "bugs resolve carries the reason" sent "reason=fixed in 1a2b3c"
check "bugs resolve carries the actor" sent "actor=tester"
run bugs resolve a1b2c3d4e5f6
check "bugs resolve needs no reason" sent "http://purrlor/bugs/a1b2c3d4e5f6/resolve"
run bugs reopen a1b2c3d4e5f6
check "bugs reopen posts to the report's route" sent "http://purrlor/bugs/a1b2c3d4e5f6/reopen"
run bugs resolve "../../pages/luna/hide"
check "bugs resolve refuses anything but an ID" never_called
check "bugs resolve says what an ID is" out_has "first column"
run bugs resolve
check "bugs resolve needs an ID" never_called

# --- what the server says ------------------------------------------------------------------------

FAKE_CODE=400 FAKE_BODY="Nope" run pages hide luna --reason spam --yes
check "a 400 fails" status_not0
check "a 400 still prints the server's message" out_has "Nope"

FAKE_CODE=207 FAKE_BODY="2 of 3 deleted" run takedown run --reason x --yes
check "a 207 counts as done" status_is 0
check "a 207 prints which failed" out_has "2 of 3 deleted"

FAKE_CURL_FAIL=7 run pages list
check "an unreachable socket fails" status_not0
check "an unreachable socket points at the token server" out_has "control socket"

FAKE_UID=1000 run pages list
check "a non-root user is told to use sudo" out_has "needs root"
check "a non-root user sends nothing" never_called

# --- the socket and what comes back from it --------------------------------------------------------

no_controls() { case "$OUT" in *$'\033'* | *$'\007'* | *$'\r'* | *$'\001'*) return 1 ;; *) return 0 ;; esac; }
FAKE_BODY=$'Hidden: \033]52;c;cHduZWQ=\007@luna\033[2J\r done\001' run pages list
check "control characters in an answer never reach the terminal" no_controls
check "the rest of the answer still does" out_has "Hidden: ]52;c;cHduZWQ=@luna[2J done"

# File modes and symlinks only mean something on Linux, where the server runs.
if [ "$(uname -s)" = Linux ]; then
  CDIR="$WORK/control"
  mkdir -p "$CDIR"
  chmod 755 "$CDIR"
  PURRLOR_CONTROL_DIR="$CDIR" run pages list
  check "a control directory others can open is refused" never_called
  check "and says why" out_has "open to other users"

  chmod 700 "$CDIR"
  : > "$CDIR/purrlor.sock"
  chmod 644 "$CDIR/purrlor.sock"
  PURRLOR_CONTROL_DIR="$CDIR" run pages list
  check "a socket others can open is refused" never_called

  chmod 600 "$CDIR/purrlor.sock"
  PURRLOR_CONTROL_DIR="$CDIR" run pages list
  check "a private directory and socket are used" sent "$CDIR/purrlor.sock"

  ln -s "$CDIR" "$WORK/linked"
  PURRLOR_CONTROL_DIR="$WORK/linked" run pages list
  check "a symlinked control directory is refused" never_called
  rm "$CDIR/purrlor.sock"
  ln -s /dev/null "$CDIR/purrlor.sock"
  PURRLOR_CONTROL_DIR="$CDIR" run pages list
  check "a symlinked socket is refused" never_called
fi

# --- peers ---------------------------------------------------------------------------------------

run peers
check "peers alone lists them" sent "http://purrlor/peers"
check "and it's a GET" sent "-G"

run peers add https://cats.example --reason "friends" --yes
check "add posts the address" sent "url=https://cats.example"
check "add carries the reason" sent "reason=friends"
check "add goes to the add route" sent "http://purrlor/peers/add"

run peers add cats.example --yes
check "add without a reason sends nothing" never_called
check "add without a reason fails" status_not0

run peers add "https://cats.example/path" --reason x --yes
check "an address with a path is refused before sending" never_called

run peers add "cats.example;id" --reason x --yes
check "an address with shell characters is refused" never_called

run peers remove cats.example --reason "defederate" --yes
check "remove goes to the server's route" sent "http://purrlor/peers/remove/cats.example"

run peers remove "../pages" --reason x --yes
check "remove refuses anything but a server name" never_called

run peers sync
check "sync posts to the sync route" sent "http://purrlor/peers/sync"

run pages hide @mochi:cats.example --reason "spam" --yes
check "a peer's person can be hidden by full ID" sent "http://purrlor/pages/@mochi:cats.example/hide"

# --- help ----------------------------------------------------------------------------------------

run help
for word in "purrlor peers add" "purrlor pages hide" "purrlor takedown file" "purrlor takedown run" "purrlor reports" "purrlor audit" "--reason"; do
  check "help mentions '$word'" out_has "$word"
done

printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
