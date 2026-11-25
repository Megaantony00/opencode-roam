# Third-party notices

OpenCode Roam depends on the following packages at runtime. Their licenses apply
to those components; the OpenCode Roam source code is licensed under
GPL-3.0-or-later. The packages are installed by `npm install` and are not
committed to this repository.

| Package | Version | License | Upstream |
| --- | --- | --- | --- |
| `@opencode/client` | 2.3.2 | MIT | https://github.com/sst/opencode |
| `@opencode/protocol` | 2.3.2 | MIT | https://github.com/sst/opencode |
| `@opencode/schema` | 2.3.2 | MIT | https://github.com/sst/opencode |
| `effect` | 4.1.0 | MIT | https://github.com/Effect-TS/effect |
| `@standard-schema/spec` | 1.1.0 | MIT | https://github.com/standard-schema/standard-schema |

The `@opencode/*` packages declare MIT in their `package.json`; the npm tarballs
do not always include a separate `LICENSE` file. Copyright belongs to the
OpenCode project and its contributors.

`@standard-schema/spec` is copyright (c) 2024 Colin McDonnell. `effect` is
copyright (c) 2023 Effectful Technologies Inc. See the license file shipped in
each installed package for the exact copyright line.

## MIT License

Copyright (c) the respective authors and contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Build tools and platform components

The Android APK is built with the Android SDK and the Android Gradle Plugin
(Apache-2.0). These are build-time tools and are not bundled as application
libraries. The APK uses only Android platform APIs; it has no third-party
Android runtime dependency.

The Node bridge bundles no third-party JavaScript into the web UI. The web UI
uses browser platform APIs only and system fonts.

## Brand assets and icons

- `assets/brand/` and the launcher/PWA icons were created for OpenCode Roam.
- The GitHub mark used in the Android and web settings link is from
  [Simple Icons](https://simpleicons.org/) (CC0 1.0) and is a trademark of
  GitHub, Inc. It is used only to link to this project's GitHub repository.
- `OpenCode`, `Tailscale`, and `Telegram` are trademarks of their respective
  owners. See `TRADEMARK.md` and the disclaimer in `README.md`.
