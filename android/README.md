# OpenCode Roam — Android wrapper

This is an optional WebView wrapper for the OpenCode Roam web UI. The web/PWA
client remains the primary target; the APK exists for native integration that a
web page cannot provide:

- **Cita** in the native text-selection menu;
- first-run setup for the bridge URL and web token;
- Android Keystore-encrypted token storage;
- settings to change the URL/token later without reinstalling;
- logout / forget token;
- language switch (English/Italian, system default);
- version, GitHub repository link, and update check;
- redesigned update dialog with release notes, APK size, and progress;
- in-app APK download and Android installer;
- native connection error screen with HTTP status and a real retry check;
- text share target;
- file chooser for attachments.

## Status

Prototype with a signed GitHub release. It is not distributed through a store.
The source lives in `android/` so the bridge, web UI, and APK version together.

## Build

Requirements: JDK 17+ (JDK 21 tested), Android SDK with platform 36 and build
tools 36.0.0, and network access for Gradle/AGP dependencies.

```bash
cd android
chmod +x gradlew
./gradlew assembleDebug
```

On Windows:

```bat
cd android
gradlew.bat assembleDebug
```

If the SDK is not found, create `android/local.properties` (ignored by Git):

```properties
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## First run

1. Enter the bridge URL, for example `https://desktop-demo.tailnet.ts.net`.
2. Paste the **web token** (not the Telegram bot token).
3. Tap **Test connection**; it calls `/api/state` with the token.
4. Save: the token is encrypted with Android Keystore and the chat opens.
5. Use the gear button to change URL/token later, switch language, check for
   updates, open the GitHub repository, or log out.

The language follows the system by default. The choice is stored in the app and
is also passed to the web UI with `?lang=`. The web UI has its own language
selector for browser use.

The APK sets an `ocb` cookie in the WebView; the token is never stored in plain
SharedPreferences.

## Quote from the native selection menu

When text is selected in the WebView, the native ActionMode menu includes
**Cita**. It calls `window.ocbQuoteSelection()` in the page, which reuses the
same quote behavior as the web UI's floating button and inserts the selection
into the composer.

The web app's `window.ocbQuoteSelection()` must exist; it is part of the bridge
web UI. Keep the APK and bridge versions reasonably close.

## Share target

Sharing text to OpenCode Roam opens the chat and inserts the text as a quote.
Image sharing is not implemented yet.

## Updates

The repository is set in `android/app/build.gradle`:

```groovy
buildConfigField "String", "GITHUB_REPO", "\"Megaantony00/opencode-roam\""
```

The app checks `releases/latest` on start and from **Settings → Check for
updates**. If a newer version exists, it shows a custom dark dialog with the
version, release notes, APK size, and a download progress bar. It downloads the
release APK from the GitHub asset over HTTPS, verifies that the archive package
name matches, and opens the Android installer. The app does not install
silently: Android asks for confirmation and may require enabling **Allow from
this source** for OpenCode Roam. The signing certificate check performed by
Android prevents installing an APK signed with a different key.

The release page remains available as a fallback if the APK asset is missing or
the download fails.

## Connection errors

When the bridge or Tailscale is unreachable, the app shows a native screen
instead of the WebView error page. **Retry** first calls `/healthz`: if it does
not return 200, the app stays on the native screen. HTTP errors such as 502,
500, or 404 also get a native screen with the status code, Retry, Settings, and
Open Tailscale. The web UI's service-worker offline page is detected and
replaced by the same native screen.

## Release signing

The debug APK is signed with Android's standard debug key and is for local
testing only. A public release needs a private release keystore:

```bash
keytool -genkeypair -v \
  -keystore opencode-roam-release.jks \
  -alias opencode-roam \
  -keyalg RSA -keysize 4096 -validity 10000
```

Keep the `.jks` file and its passwords out of the repository and back them up.
Copy `keystore.properties.example` to `android/keystore.properties`, fill it in,
place the `.jks` at the path it references, then build the signed release:

```bash
cd android
./gradlew assembleRelease
```

The output is `app/build/outputs/apk/release/app-release.apk`. Verify it with
`apksigner` and publish its SHA-256. If the key is lost, updates under the same
application ID will no longer be possible; if it leaks, someone else can sign
updates.

`dist/` is only a local, Git-ignored staging folder for APK/AAB files and
checksums. It is not part of the source tree.

## Security notes

- HTTPS is required except for localhost/emulator loopback.
- WebView file access is disabled; content access is enabled only for the file
  chooser.
- No JavaScript interface is exposed. Native quote uses `evaluateJavascript`.
- The app does not store the Telegram token.
- Never commit `local.properties`, signing keys, or generated build output.

## Device test

Tested on Android 15 with the release APK:

- first-run setup screen and connection test;
- saved token survives an app relaunch (encrypted storage);
- chat WebView loads through Tailscale;
- native selection toolbar shows **Cita**, **Copia**, **Cerca**, **Condividi**;
- **Seleziona tutto** is in the three-dot overflow;
- **Cita** inserts the selected text into the composer;
- **Cerca** opens the default browser with the selected text;
- **Copia** uses the Android clipboard;
- sharing text to OpenCode Roam inserts it as a quote;
- language switch between English and Italian;
- version, GitHub link, and update check;
- in-app update flow tested end-to-end from 0.1.1 to 0.1.2; the redesigned
  0.1.3 dialog awaits its first live update;
- native HTTP 502 screen and retry tested with the bridge stopped and restarted;
- the retry stays on the native screen while the bridge is down and loads the
  chat once `/healthz` returns 200.

## Limitations

- WebView wrapper, not a Trusted Web Activity; it is a separate UI shell.
- No background push notifications yet; use the PWA/web UI or Telegram.
- No image share target yet.
- Release signing is configured; store distribution is not available yet.
- The updater cannot install silently; Android always requires confirmation.
