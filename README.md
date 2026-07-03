# Claude Shell

A Windows desktop app for Claude Code — like Claude Desktop, but it drives the real Claude Code agent in your own project folders, using your Claude subscription.

## Features

- **Streaming chat** with markdown rendering and live tool-call cards (inputs, results, success/error state)
- **Multi-session tabs** — run several conversations side-by-side, each in its own project folder
- **Tool approval UI** — visual prompts when Claude wants to edit files (with diff preview) or run commands, plus permission modes: Ask / Auto-edit / Plan / Bypass
- **Session history** — browse and resume past Claude Code sessions (including ones from the terminal CLI); resumed chats rebuild their full transcript
- **Usage dashboard** — per-session tokens, cache hits, cost, and a live context-window gauge
- **Claude account login** — uses your existing `claude /login` automatically; if logged out, a guided `claude setup-token` flow stores a token encrypted with Windows DPAPI

## Requirements

- Windows 11, Node 18+ (developed on Node 24)
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed (`npm i -g @anthropic-ai/claude-code`) with a Claude Pro/Max subscription (or an API key)

## Run

```powershell
npm install
npm run dev        # development with hot reload
npm run build:win  # package a Windows installer (electron-builder)
```

## Tests

```powershell
npm run typecheck
npx playwright test   # E2E: drives the real app, needs a logged-in Claude account
```

Screenshots from test runs land in `tests/e2e/__screenshots__`.

## Architecture

```
src/shared/ipc-contract.ts   All IPC channels + payload types (single source of truth)
src/main/session-manager.ts  One streaming query() per tab via @anthropic-ai/claude-agent-sdk
src/main/approvals.ts        canUseTool → renderer approval round-trip
src/main/auth.ts             login detection, setup-token flow, DPAPI token storage
src/main/history.ts          session enumeration via the SDK's listSessions()
src/renderer/                React 19 + Tailwind v4 + zustand
```

Key design points:

- The Agent SDK runs in Electron's **main process**; each tab owns a persistent streaming-input `query()` (required for the `canUseTool` permission callback and live `interrupt`/`setPermissionMode`/`setModel`).
- The renderer never imports SDK types — main maps SDK messages into small `UiEvent`s over typed IPC, so SDK version drift is isolated (the SDK is pinned exact).
- Resume uses `getSessionMessages()` to rebuild the transcript, then `resume:` for live context.

## Note on Claude-account login

Anthropic permits subscription (claude.ai) auth for your **own** use. Distributing an app that offers claude.ai login to other users requires Anthropic's approval — if you share this app, others should use their own Claude Code login or an API key.
