# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/dylmlank/seashell/security/advisories/new)
rather than opening a public issue. I'll acknowledge within a week.

## What Seashell touches

Worth knowing if you're assessing the risk of running it:

- **It executes commands and edits files on your machine.** That is the whole
  point of the app — Claude Code drives your project folders. The approval UI
  (Ask / Auto-edit / Plan / Bypass) is what stands between a tool call and your
  disk. `Bypass` disables that check; it means what it says.
- **It stores credentials.** A Claude OAuth token, an OpenRouter key, and a
  custom-endpoint key, each encrypted at rest — DPAPI (CurrentUser) on Windows,
  Keychain on macOS, libsecret on Linux. They live under the app's data folder,
  reachable from Settings → Open data folder.
- **It runs a localhost WebSocket.** The Rust shell generates a 128-bit secret
  per launch and hands it to both the sidecar and the webview; the sidecar
  refuses to start without one, checks it on every connection, and rejects any
  `Origin` other than its own webview. Nothing binds beyond `127.0.0.1`.
- **File reads and writes over that socket are scoped to the session's project
  folder**, with one deliberate exception: a file that is the subject of a
  pending approval can be read so the approval dialog can diff it.

## Builds are not code-signed

Releases are unsigned — certificates cost money this project doesn't have.
Windows SmartScreen and macOS Gatekeeper will both complain. Verify the
SHA256 checksums published with each release if that matters to you, and build
from source if it matters a lot.

## Scope

Seashell drives the Claude Code CLI and the Claude Agent SDK. Issues in those
belong to [Anthropic](https://github.com/anthropics/claude-code/issues); issues
in how Seashell invokes, sandboxes, or exposes them belong here.
