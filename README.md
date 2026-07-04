# 🐚 Seashell

**Seashell** (sea-shell → C-shell → *Claude* shell) is a Windows desktop app for Claude Code — like Claude Desktop, but it drives the real Claude Code agent in your own project folders, using your Claude subscription. Built on **Tauri (Rust) + Bun** — the UI is a native WebView2 window, terminals are native ptys, and the Claude Agent SDK runs in a Bun sidecar.

## Features

- **Streaming chat** with markdown rendering and live tool-call cards (inputs, results, success/error state)
- **Slash commands** — native `/` actions that drive the app (`/commit`, `/run`, `/model`, `/mode`, `/kill`, panel toggles) plus your own reusable prompt macros stored in `.claude/commands/*.md` (portable to the CLI), all in one rich autocomplete with a built-in manager
- **Multi-session tabs** — run several conversations side-by-side, each in its own project folder, with at-a-glance status (working / needs you / ready / error) in the sidebar
- **Thinking controls** — pick how hard Claude reasons per session (No thinking → Low → Medium → High → Ultra, like Claude Code), changeable live
- **Self-extending** — Claude proactively creates project skills for repeated or hard tasks, slash commands, subagents, and its own tools, and installs plugins/MCP servers when they fit (toggleable in Settings)
- **Live preview** — an embedded browser pointed at your dev server: it auto-detects running ports and, if none is up, **starts your project's dev server for you** (`dev`/`start`/`serve`/`preview` script, right package manager) when you open the pane — with refresh/auto-refresh, open-in-browser, and a file mode for the last HTML/SVG/Markdown Claude wrote
- **Checkpoints / time-travel** — a timeline of every turn showing which files it changed; restore your project's files to any earlier checkpoint in one click (the conversation is kept)
- **Tool approval UI** — visual prompts when Claude wants to edit files (with diff preview) or run commands, plus permission modes: Ask / Auto-edit / Plan / Bypass
- **Session history** — browse and resume past Claude Code sessions (including ones from the terminal CLI); resumed chats rebuild their full transcript
- **Usage dashboard** — per-session tokens, cache hits, cost, and a live context-window gauge
- **Claude account login** — uses your existing `claude /login` automatically; if logged out, a guided `claude setup-token` flow stores a token encrypted with Windows DPAPI
- **Multiple providers** — your Claude subscription by default, OpenRouter credits, or any custom Anthropic-compatible endpoint (LiteLLM/local proxies, other gateways), switchable per session
- **Desktop-grade extras** — global summon hotkey (Ctrl+Shift+Space), response styles (concise/explanatory/formal), one-click GitHub PR creation, open-in-Explorer/VS Code, message queueing, session templates, worktree sessions, smart per-message thinking budgets

## Requirements

- Windows 11
- [Bun](https://bun.sh) (runs the sidecar and the tooling)
- Rust toolchain (stable-msvc, for the Tauri shell)
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed (`npm i -g @anthropic-ai/claude-code`) with a Claude Pro/Max subscription (or an API key)

## Run

```powershell
bun install
bun run dev      # tauri dev: vite + cargo + Bun sidecar, hot reload
bun run build    # tauri build → NSIS installer with the sidecar bundled
bun run typecheck
```

## Architecture

```
src-tauri/                   Rust shell: window, pty terminals (portable-pty),
                             sidecar spawn/supervision, save/open commands
src/sidecar/                 Bun sidecar: the Claude Agent SDK, sessions, history,
                             transcripts, git, OpenRouter, Desktop-connector import —
                             served to the UI over a localhost WebSocket
src/shared/ipc-contract.ts   All channels + payload types (single source of truth)
src/renderer/                React 19 + Tailwind v4 + zustand + CodeMirror + xterm
src/renderer/src/lib/api.ts  window.api shim: WebSocket to the sidecar + Tauri
                             commands/plugins for dialogs, saves, notifications
```

Key design points:

- The Agent SDK runs in the **Bun sidecar**; each tab owns a persistent streaming-input `query()` (required for the `canUseTool` permission callback and live `interrupt`/`setPermissionMode`/`setModel`).
- The renderer never imports SDK types — the sidecar maps SDK messages into small `UiEvent`s over the typed contract, so SDK version drift is isolated (the SDK is pinned exact).
- The WebSocket is guarded by a per-launch secret the Rust shell generates and hands to both sides; tokens are DPAPI-encrypted on disk (same blobs the old Electron build wrote).
- Terminals are Rust-side ptys streamed over Tauri events; xterm instances live outside React so they survive panel switches.
- Resume uses `getSessionMessages()` to rebuild the transcript, then `resume:` for live context.

## Note on Claude-account login

Anthropic permits subscription (claude.ai) auth for your **own** use. Distributing an app that offers claude.ai login to other users requires Anthropic's approval — if you share this app, others should use their own Claude Code login or an API key.

## License

MIT — see [LICENSE](LICENSE).
