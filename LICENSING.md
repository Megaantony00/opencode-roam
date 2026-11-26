# Licensing and compliance notes

This is an engineering audit of the OpenCode Roam repository at version 0.1.4.
It is not legal advice. For commercial use or a store release, have a lawyer
review the project, the brand assets, and your distribution model.

## Project license

The source code is licensed under **GPL-3.0-or-later**. See `LICENSE` and
`NOTICE`. The GPL applies to the code; it does not grant rights to the project
name or logo, which are covered by `TRADEMARK.md`.

If you distribute a modified version, you must:

- keep the source available under the GPL;
- preserve copyright, license, and warranty notices;
- state the changes you made;
- not imply that the modified build is the original OpenCode Roam project.

## Dependency audit

The bridge has one direct runtime dependency, `@opencode/client`, which brings
four transitive packages. All declared licenses are MIT:

- `@opencode/client` 2.3.2 — MIT
- `@opencode/protocol` 2.3.2 — MIT
- `@opencode/schema` 2.3.2 — MIT
- `effect` 4.1.0 — MIT
- `@standard-schema/spec` 1.1.0 — MIT

MIT is compatible with GPL-3.0-or-later. The MIT notice is reproduced in
`THIRD_PARTY_NOTICES.md`; the full texts are in the installed packages under
`node_modules/<package>/LICENSE`.

The development dependency set is empty apart from the Node.js test runner. The
Android APK has no third-party runtime library; it uses Android platform APIs
and is built with the Android Gradle Plugin (Apache-2.0, build-time only).

Run the audit again after dependency changes:

```bash
npm ls --all
npm audit --omit=dev
node -e "const p=require('./package-lock.json'); for (const [k,v] of Object.entries(p.packages)) if (v.license) console.log(k, v.license)"
```

## Distribution checklist

- Publish the source for the exact tag used to build the APK.
- Attach the signed APK and its SHA-256 checksum to the GitHub release.
- Keep the signing key and `keystore.properties` private and backed up.
- Do not publish `opencode-roam.json`, logs, tokens, or personal paths.
- Keep `THIRD_PARTY_NOTICES.md`, `LICENSE`, `NOTICE`, and `TRADEMARK.md` in the
  source distribution.
- If you publish a modified build, use a different name and logo.

## Trademarks and disclaimers

OpenCode Roam is an unofficial community project. It is not affiliated with,
endorsed by, or sponsored by OpenCode, Tailscale, or Telegram. Their names are
used only to describe interoperability. The GitHub mark is used only to link to
the project repository.

## Assets and privacy

- The brand images in `assets/brand/` and the PWA/launcher icons were created
  for this project.
- The chat screenshots in `docs/screenshots/` are generated from a synthetic
  demo; the APK setup screenshot has empty fields.
- No third-party fonts, stock photos, or icon packs are bundled.
- The repository must not contain real tokens, chat IDs, hostnames, or personal
  data. Check screenshots and logs before publishing.

## Security and release hygiene

- `npm audit --omit=dev` before every release.
- Build the release from a clean checkout and verify the APK signature.
- Publish `SHA256SUMS.txt` with the APK.
- The in-app updater downloads the APK from the GitHub release over HTTPS and
  lets Android verify the package name and signing certificate before install.
  Android still asks the user to confirm every sideloaded installation.
