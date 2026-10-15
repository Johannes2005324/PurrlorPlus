#!/bin/sh
# Writes the web client's per-deployment config (apps/web/src/app/runtimeConfig.ts) from this
# container's environment. The nginx image runs every executable /docker-entrypoint.d/*.sh before
# starting nginx, so this happens on each container start — changing these in .env and recreating
# the container is enough, no image rebuild.
#
#   PURRLOR_HOMESERVER_URL    locks the login and register screens to one homeserver
#   PURRLOR_LIVEKIT_URL       } this deployment's voice server, given to Spaces that don't have
#   PURRLOR_TOKEN_ENDPOINT    } one yet (apps/web/src/matrix/deploymentDefaults.ts)
#   PURRLOR_PUSH_GATEWAY_URL  this deployment's push gateway, the default for notifications
#   PURRLOR_ANDROID_PACKAGE   } the Android app (apps/android) this site vouches for, and the
#   PURRLOR_ANDROID_CERT_SHA256 } SHA-256 fingerprints of the keys it's signed with (comma-separated:
#                               your upload key and Google Play's app signing key). Written to
#                               /.well-known/assetlinks.json, which is what lets the app open this
#                               site full screen, without Chrome's address bar. Unset: no file.
#
# Any of them unset or empty is written as "", which the client reads as "not set": it then
# behaves as a general-purpose client and asks for that setting instead.
set -eu

# Escape the two characters that could break out of a JSON string. Everything else a URL or
# server name can contain is fine as-is.
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

printf '{"homeserver":"%s","livekitUrl":"%s","tokenEndpoint":"%s","pushGateway":"%s"}\n' \
  "$(json "${PURRLOR_HOMESERVER_URL:-}")" \
  "$(json "${PURRLOR_LIVEKIT_URL:-}")" \
  "$(json "${PURRLOR_TOKEN_ENDPOINT:-}")" \
  "$(json "${PURRLOR_PUSH_GATEWAY_URL:-}")" \
  > /usr/share/nginx/html/config.json

# Digital Asset Links for the Android app (apps/android/README.md). Fingerprints are hex pairs
# with colons; anything else in the list is dropped, so a typo can't break the JSON.
ASSETLINKS=/usr/share/nginx/html/.well-known/assetlinks.json
rm -f "$ASSETLINKS"
if [ -n "${PURRLOR_ANDROID_PACKAGE:-}" ] && [ -n "${PURRLOR_ANDROID_CERT_SHA256:-}" ]; then
  if printf '%s' "$PURRLOR_ANDROID_PACKAGE" | grep -Eq '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'; then
    fingerprints=$(printf '%s' "$PURRLOR_ANDROID_CERT_SHA256" | tr ', ' '\n\n' | tr 'a-f' 'A-F' |
      grep -E '^([0-9A-F]{2}:){31}[0-9A-F]{2}$' | sed 's/.*/"&"/' | paste -sd, -)
    if [ -n "$fingerprints" ]; then
      mkdir -p "$(dirname "$ASSETLINKS")"
      printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":[%s]}}]\n' \
        "$PURRLOR_ANDROID_PACKAGE" "$fingerprints" > "$ASSETLINKS"
      echo "purrlor: wrote assetlinks.json for the Android app $PURRLOR_ANDROID_PACKAGE"
    else
      echo "purrlor: PURRLOR_ANDROID_CERT_SHA256 has no valid SHA-256 fingerprint; no assetlinks.json"
    fi
  else
    echo "purrlor: PURRLOR_ANDROID_PACKAGE isn't a package name; no assetlinks.json"
  fi
fi

# This server's own Terms of Service (custom/terms.html in the install, mounted by
# deploy/docker-compose.yml) replaces the sample the image ships. Copied on each start, so editing
# the file and restarting the container is enough.
if [ -f /etc/purrlor/custom/terms.html ]; then
  cp /etc/purrlor/custom/terms.html /usr/share/nginx/html/terms.html
  echo "purrlor: using this server's terms (custom/terms.html)"
else
  echo "purrlor: no custom/terms.html — showing the sample Terms of Service"
fi

echo "purrlor: wrote config.json (homeserver: ${PURRLOR_HOMESERVER_URL:-<not locked>}," \
  "voice: ${PURRLOR_LIVEKIT_URL:-<per space>}, push: ${PURRLOR_PUSH_GATEWAY_URL:-<per account>})"
