# Contributing

Thanks for helping OpenCode Roam. The project is a self-hosted bridge between
OpenCode and a private web UI/PWA, with optional Telegram support.

## Before opening an issue

- Search existing issues.
- Remove tokens, hostnames, chat IDs, personal paths, and screenshots containing
  real data.
- Use a synthetic example such as `https://desktop-demo.tailnet.ts.net`.

## Development

Requirements: Node.js 20 or newer, npm, and OpenCode 2.x.

```bash
git clone https://github.com/Megaantony00/opencode-roam.git
cd opencode-roam
npm install
npm test
```

Useful commands:

```bash
npm run setup:web
npm start
```

For local UI work, use a temporary config so you do not touch your real bridge:

```powershell
$env:OPENCODE_ROAM_CONFIG = "$env:TEMP\opencode-roam-dev.json"
npm run setup:web
npm start
```

For the Android wrapper (optional):

```bash
cd android
./gradlew assembleDebug
```

Do not commit:

- `opencode-roam.json`;
- `logs/`;
- bot tokens or web tokens;
- personal screenshots;
- signing keys (`*.jks`, `*.keystore`).

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add or update tests when changing the bridge, web transport, setup, or
  service worker behavior.
- Run `npm test` before opening the PR.
- Write commit messages in English.
- By contributing, you agree that your contribution is licensed under
  GPL-3.0-or-later.

## Screenshots and demos

Use fake sessions, fake messages, fake hostnames, and fake tokens. Never include a
real Tailscale hostname, bot username, chat ID, personal path, or token.

## Security

Please follow `SECURITY.md` for vulnerabilities. Do not open a public issue with a
working exploit or secret.
