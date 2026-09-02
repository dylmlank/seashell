# Contributing to Seashell

Thanks for helping! The short version:

```bash
bun install
bun run dev        # tauri dev: vite + cargo + Bun sidecar, hot reload
bun run typecheck  # both tsconfigs
bun run lint
bun run test       # both suites
bun run test:ui    # component tests only
cargo test --manifest-path src-tauri/Cargo.toml
```

- Tests live in two places. `tests/` runs under plain Bun; `tests-ui/` needs a
  DOM and registers happy-dom, which replaces globals (`WebSocket` among them)
  for every file sharing a `bun test` run — so it gets its own invocation.
  Adding a component test to `tests/` will break `sidecar.test.ts`.
- **Architecture** is described in the README. The one rule that matters:
  the renderer never imports SDK types — the sidecar maps SDK messages into
  the shared `UiEvent` contract (`src/shared/ipc-contract.ts`).
- The Agent SDK version is **pinned exact** on purpose (pre-1.0 shapes drift).
  Before bumping it, run `bun run canary` — it exercises every SDK surface the
  app depends on and tells you exactly what an upgrade would break.
- Keep diffs focused; match the surrounding style. `bun run lint` must pass.
- Windows is the primary tested platform. macOS/Linux fixes are very welcome —
  platform-specific code lives in `src/sidecar/platform.ts` and behind
  `cfg` attributes in `src-tauri/src/lib.rs`.

Open an issue first for anything large, so we can agree on the shape before
you spend time on it.
