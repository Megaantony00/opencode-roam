# Security Policy

OpenCode Roam is a self-hosted remote control for OpenCode. It can send prompts,
read session output, approve tool permissions, and run commands through your
OpenCode session. Treat access to the bridge as access to your PC.

## Supported versions

Security fixes are provided for the latest release on the `main` branch.

## Reporting a vulnerability

Please do **not** open a public issue containing a token, a full web URL, a
Tailscale hostname, a chat ID, or personal data.

Use GitHub's private vulnerability reporting (Security → Advisories → Report a
vulnerability) for this repository. Do not publish sensitive details in a public
issue.

Include:

- affected version or commit;
- steps to reproduce;
- impact;
- whether the issue is reproducible without a valid token;
- any suggested fix.

## Threat model

The intended deployment is:

- one user;
- the bridge listening on `127.0.0.1`;
- access through `tailscale serve`, never through `tailscale funnel`;
- the web token kept secret;
- Telegram optional.

The web UI is not designed to be exposed directly to the public internet. If you
put it behind a reverse proxy or a public tunnel, you are responsible for TLS,
authentication, rate limiting, and access control.

## Secrets

- `web.token` authenticates the browser to the local web server. It is not a
  Telegram token.
- `token` is the Telegram bot token from BotFather. It is only used when
  Telegram is enabled.
- `opencode-roam.json` contains secrets and personal paths. It is ignored by Git
  and must never be committed.
- `logs/bridge.log` can contain the web URL including the token. Do not share it.
- The optional Android APK stores the bridge URL and web token with Android
  Keystore / EncryptedSharedPreferences. The Telegram token stays on the PC.
  Release APKs are signed and published with SHA-256 checksums; the updater
  downloads over HTTPS and Android verifies the package name and signing
  certificate before installing.

If a token leaks:

1. Web token: generate a new `web.token` in the config and restart the bridge.
2. Telegram token: revoke it with BotFather (`/revoke`) and run the setup again.
3. Tailscale: revoke the device in the Tailscale admin console if needed.

## Prompt injection

OpenCode reads files, web pages, tool output, and other untrusted content. That
content can contain instructions that try to make the agent do something harmful.
OpenCode Roam does not make prompt injection safe: keep permission rules
restrictive and review approval requests before accepting them.

## Dependency and release hygiene

- `npm audit` before releases.
- Release source must match the published APK when an APK is published.
- Never publish a signing key.
- Publish checksums for release APKs.
