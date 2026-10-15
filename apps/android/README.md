# Purrlor for Android

An Android app for **Purrlor**: a [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity)
(TWA) that opens the Purrlor site (`https://purr.meowops.net/` by default) full screen in the
phone's Chrome. There's no app code of its own, only Google's launcher library
(`androidbrowserhelper`), so the app is the website: every deploy of the web client reaches the
app at once, with nothing to rebuild, and the web client and the Windows app don't change.

It's light because it is Chrome: no second browser engine in the app, an install of about a
megabyte, and the same memory the site uses in a Chrome tab.

## What works

The same as Purrlor in Chrome on the phone, since that's what it is:

- Sign-in, encryption keys and settings, kept by Chrome for that site (the app and a Chrome tab
  on the same site share them)
- Notifications through the site's Web Push (the push gateway, unchanged), shown as the app's.
  On Android 13 and later the app asks for permission to show them
- Voice and video calls, screen share where Chrome on Android has it
- Sharing pictures, videos and links to Purrlor from other apps, through the site's share target
- Links to `https://purr.meowops.net/...` open in the app

Not yet, as with the site in Chrome: a call keeps going while the app is in the background only as
long as Android lets Chrome keep it, which varies by phone and battery settings. Keeping calls
alive for good needs a native foreground service, which a TWA doesn't have.

## Full screen, or Chrome's address bar

The app opens the site without an address bar only once the site vouches for it: Android fetches
`https://purr.meowops.net/.well-known/assetlinks.json` and checks it names this app and the key
it's signed with. Until it does, the app still works, with Chrome's address bar showing.

The web container writes that file from two settings in the deployment's `.env`
(`apps/web/deploy/40-purrlor-config.sh`), then `purrlor restart web` (or recreate the container):

| Setting | What |
| --- | --- |
| `PURRLOR_ANDROID_PACKAGE` | The app's package name: `net.meowops.purrlor` |
| `PURRLOR_ANDROID_CERT_SHA256` | SHA-256 fingerprints of the keys the app is signed with, comma-separated: `AB:CD:…` |

Which fingerprints:

- **Your upload key**, the one the release build is signed with (below):
  `keytool -list -v -keystore upload.jks -alias upload` prints it under "SHA256".
- **Google Play's app signing key**, if the app goes on Play: Play re-signs what you upload, so
  phones see Play's key. It's in Play Console → your app → Test and release → App integrity →
  App signing. List both.
- To try a **debug build** full screen, its key too: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`.

Check it with `curl https://purr.meowops.net/.well-known/assetlinks.json`, or Google's
[Statement List tester](https://developers.google.com/digital-asset-links/tools/generator).

## Building

The [Android workflow](../../.github/workflows/android.yml) builds a debug APK on every change to
`apps/android` (download it from the run's artifacts). A tag `android-vX.Y.Z` matching
`versionName` in `app/build.gradle` builds the signed release APK and the Play bundle (AAB) and
publishes them as a GitHub release.

Release signing uses four repository secrets:

| Secret | What |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The upload keystore, base64: `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Its password |
| `ANDROID_KEY_ALIAS` | The key's alias (`upload` below) |
| `ANDROID_KEY_PASSWORD` | The key's password |

Make the upload key once, and keep it (and a copy) somewhere safe: an app on Play can only be
updated with it, or by asking Google to reset it.

```sh
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Bump `versionCode` (by one) and `versionName` in `app/build.gradle` for each release.

### On your own computer

With [Android Studio](https://developer.android.com/studio) (or a JDK 17, the Android SDK and
Gradle 8.11): open `apps/android`, or run `gradle assembleDebug` there. The APK is in
`app/build/outputs/apk/debug/`. The Gradle wrapper isn't checked in; `gradle wrapper` makes one if
you want it. To sign a release locally, set `PURRLOR_KEYSTORE` (the path to `upload.jks`),
`PURRLOR_KEYSTORE_PASSWORD`, `PURRLOR_KEY_ALIAS` and `PURRLOR_KEY_PASSWORD`, then
`gradle assembleRelease bundleRelease`.

## For another deployment

The app opens one server. For your own, set these in `gradle.properties` (or pass
`-Ppurrlor.host=app.example.com` and so on to `gradle`), and use the same package name in that
server's `PURRLOR_ANDROID_PACKAGE`:

| Property | Default |
| --- | --- |
| `purrlor.host` | `purr.meowops.net`, the address you open Purrlor at in a browser |
| `purrlor.applicationId` | `net.meowops.purrlor`; yours must differ to be on Play, and is permanent once it is |
| `purrlor.appName` | `Purrlor` |

Unlike the Windows app, it doesn't ask which server: a TWA is bound to the one site that vouches
for it. Someone on another server can still use that server's site in Chrome, and install it from
Chrome's menu (Add to Home screen), which the site already supports.
