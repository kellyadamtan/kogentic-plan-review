# Optional Kogentic connector

The connector lets you send one plan to a Kogentic workspace so a teammate can approve it from another
device. It is **off by default** and inert until you opt in. The Kogentic API is not public yet; the
client is built and tested against a local mock server.

## Turning it on

In your **user** settings (these settings are machine-scoped, so a workspace cannot set them):

```json
{
  "kogenticPlanReview.kogentic.enabled": true,
  "kogenticPlanReview.kogentic.baseUrl": "https://your-kogentic-host"
}
```

Then run **Kogentic: Sign In to Kogentic** and paste an API key (`kg_…`). It is stored with VS Code
SecretStorage. **Kogentic: Sign Out of Kogentic** deletes it.

## What is sent

**Kogentic: Send Plan to Kogentic** opens the exact JSON below in an editor and asks before sending:

```json
{
  "agent": "claude-code | cursor | copilot | generic",
  "title": "Plan title",
  "body_md": "the plan's markdown (without frontmatter)",
  "hash": "sha256 of the plan text",
  "files_touched": ["src/a.ts"],
  "checklist": { "risks": 1, "items": [{ "id": "tests", "level": "risk", "label": "Tests" }] },
  "repo": { "name": "folder name", "sha": "HEAD commit" }
}
```

Request: `POST <baseUrl>/v1/plans` with `Authorization: Bearer <key>` and `Content-Type: application/json`.
Expected response: `{ "plan_id": "…", "url": "…" }`.

## Safety rules

- No default URL. `https://` is required; `http://` only for `localhost`, `127.0.0.1`/`127.x` and `[::1]`.
- URLs with embedded credentials are refused.
- **Redirects are never followed.** Any 3xx response is an error, so the key and the plan cannot be
  moved to plain http or to another host.
- Nothing is sent without the confirmation dialog. Comments are not sent.
- No telemetry: this command is the only code path that makes an outgoing request.
