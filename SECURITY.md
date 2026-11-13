# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately with GitHub's
[private vulnerability reporting](https://github.com/kellyadamtan/kogentic-plan-review/security/advisories/new).
We aim to acknowledge reports within a few working days.

Useful details: the extension version, your editor and OS, and steps to reproduce.

## Scope notes

- The Claude Code gate listens on `127.0.0.1` only and requires a per-session random token in the
  `x-kogentic-gate-token` header. Requests with an `Origin` header or an unexpected `Host` header are
  refused. Anything that lets another machine, a web page or a request without the token reach the gate
  is in scope. See "Security model of the gate" in the README.
- The extension makes no network calls except the opt-in "Send to Kogentic" command, which requires
  https (http only for localhost), never follows redirects, and asks before sending.
- The API key for the connector is kept in VS Code SecretStorage.
- v0.1 `.vsix` files are unsigned. Verify downloads against `SHA256SUMS.txt` and the GitHub attestation.
