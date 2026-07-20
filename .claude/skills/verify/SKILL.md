---
name: verify
description: Build, launch, and drive the atelier preview app to verify changes end-to-end.
---

# Verifying atelier changes in the running app

## Launch

- `pnpm install` first if node_modules is missing (fresh worktrees).
- Dev server: `pnpm dev` (runs `preview/web` vite server on `127.0.0.1:4175`).
  A `.claude/launch.json` config named `atelier-preview` exists for the
  browser-pane `preview_start` tool.
- The preview seeds `preview/web/seed/**` into a fresh in-memory lix on every
  page load (see `preview/web/seed-workspace.ts`). Drop fixture files there to
  get them into the workspace; edits do not survive reload.

## Driving the app

- The file tree is a custom element (`FILE-TREE-CONTAINER`, `@pierre/trees`);
  its rows are not exposed to `read_page`.
- `computer` clicks take SCREENSHOT-pixel coordinates (the tool scales them by
  viewport/screenshot itself). To click a DOM element reliably, measure it in
  the page and convert: `rect_center * (screenshot_width / window.innerWidth)`
  (screenshot width is typically 800). Passing CSS/viewport coords overshoots
  ~1.2x and lands clicks on the wrong element.
- The Files app listing sometimes renders a stale/truncated file list after
  reload even though lix has all rows (pre-existing quirk). Bypass it by
  opening documents programmatically: grab the runtime via a fiber walk for
  `memoizedProps.atelier`, then `atelier.documents.open("/path.csv")`.
- glide-data-grid (CSV view) is canvas-based. Browser-pane synthetic clicks
  select cells but do NOT move DOM focus; call
  `document.querySelector("[data-testid='data-grid-canvas']").focus()` via
  javascript_tool first, then `computer key` events reach the grid.
- The glide overlay cell editor mounts into `#portal` (created on demand by
  the CSV view). After Enter opens it, `#portal textarea` is focused; type and
  Enter commits.
- To inspect or mutate the app's live lix store from the page: grab any React
  fiber (e.g. from the grid canvas), walk `fiber.return` until
  `memoizedProps.lix` appears (LixProvider), then `await lix.execute(sql)`.
  Useful queries: `SELECT data FROM lix_file WHERE path = '/x.csv'`, and join
  `lix_change.origin_key` via `lix_file.lixcol_change_id` to check write
  origins. Writing via `lix.execute` without an originKey simulates an
  external/agent write and exercises editors' observe→reconcile loops.

## Gotchas

- A stray click on a grid's trailing "New row…" row appends (and persists) an
  empty row immediately.
- `pnpm test` / `pnpm typecheck` / `pnpm lint` are CI, not verification.
