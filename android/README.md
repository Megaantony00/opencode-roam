# OpenCode Roam — Android wrapper

This is an optional WebView wrapper for the OpenCode Roam web UI. The web/PWA
client remains the primary target; the APK exists for native integration that a
web page cannot provide:

- **Cita** in the native text-selection menu;
- first-run setup for the bridge URL and web token;
- Android Keystore-encrypted token storage;
- settings to change the URL/token later without reinstalling;
- logout / forget token;
- text share target;
- file chooser for attachments;
- update check from GitHub Releases (opens the release page; Android still asks
  before installing a sideloaded APK).

## Status

Prototype, debug build only. It is not signed for release and is not on a store.
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
5. Use the gear button to change URL/token later or to log out.

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

The checker reads the latest GitHub release and opens its page. Silent APK
installation is not allowed by Android; a signed release and checksums are
required before distributing a public APK.

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

Tested on Android 15 with the debug APK:

- first-run setup screen and connection test;
- saved token survives an app relaunch (encrypted storage);
- chat WebView loads through Tailscale;
- native selection toolbar shows **Cita**, **Copia**, **Cerca**, **Condividi**;
- **Seleziona tutto** is in the three-dot overflow;
- **Cita** inserts the selected text into the composer;
- **Cerca** opens the default browser with the selected text;
- **Copia** uses the Android clipboard;
- sharing text to OpenCode Roam inserts it as a quote.

Not yet verified end-to-end: update checker. It needs a published GitHub release
to compare against; it remains a best-effort check that opens the release page.

## Limitations

- WebView wrapper, not a Trusted Web Activity; it is a separate UI shell.
- No background push notifications yet; use the PWA/web UI or Telegram.
- No image share target yet.
- No release signing / store distribution yet.
