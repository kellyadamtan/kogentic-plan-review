# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately with GitHub's
[private vulnerability reporting](https://github.com/kellyadamtan/kogentic-plan-review/security/advisories/new).
We aim to acknowledge reports within a few working days.

Useful details: the extension version, your editor and OS, and steps to reproduce.

## Scope notes

- The extension opens no listening socket and never talks to a coding agent.
- Writes under `.kogentic/` and to `.gitignore` refuse symbolic links and paths outside the workspace.
  Anything that makes the extension write outside the open folder is in scope.
- The review panel runs with a strict Content Security Policy; a way to run script in it is in scope.
- The extension makes no network calls except the opt-in "Send to Kogentic" command, which requires
  https (http only for localhost), never follows redirects, and asks before sending.
- The API key for the connector is kept in VS Code SecretStorage.
- v0.1 `.vsix` files are unsigned. Verify downloads against `SHA256SUMS.txt` and the GitHub attestation.
