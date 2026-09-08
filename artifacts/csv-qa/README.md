# CSV QA loop

Base: latest main `5c3422e`. Branch: `fix/csv-qa-loop`.

Three subagents independently investigated typing/property editors, persistence, and filters/sorting/review. Root investigated parsing and structural edit persistence. Each confirmed defect was fixed and followed by fresh cases; the loop ended after all three subagents reported clean follow-up rounds in their tested scopes.

## Fixes

- Keep modifier-click range selection from opening an editor or toggling checkbox data, including forwarding Alt state through Glide mouse events.
- Preserve composing keys in property pickers and the Glide overlay. Only finish keys schedule overlay completion, preventing rapid multiline typing followed by Enter from canceling the edit.
- Preserve queued edits across review/read-only transitions and file closure. Capture content-write intent so property changes cannot overwrite externally updated CSV bytes. Reject stale reconciliation/reload responses.
- Use a consistent numeric comparator in live and review grids. Respect stable column IDs when matching review columns.
- Preserve final empty single-column rows on reopening; parse live and historical CSV consistently, including empty trailing records and mixed line endings; avoid generated header label collisions.

## Final validation

- CSV suite: **233 passed** across 19 files.
- Full repository suite: **1,342 passed, 1 skipped, 1 baseline failure** across 113 files. The sole failure is `lix-diff-commands.test.ts > sweeps the selected file's new directories into the checkpoint`, reporting `filesystem descriptor is missing its snapshot`. Reproduced independently on untouched `5c3422e`; see `baseline-checkpoint.log`.
- Typecheck, production build, CSV lint, changed-source formatting and diff whitespace checks pass.
- Actual Chromium/Glide browser matrix: **20 scenarios pass**, no page errors. Details and reusable harness in `keyboard/`.
- Independent final parser/view/persistence integration audit: **79 passed**. Persistence alone: **19 passed** against actual Lix storage.

## Evidence and scope

See [keyboard](keyboard/README.md), [persistence](persistence.md), and [views/review](views-review.md) for rounds and reproduction commands. Browser checks use production Glide and property editors; CsvTable mapping and saves use actual component callbacks and Lix with the canvas mocked. Browser tests do not constitute a full Atelier Shell end-to-end run or native operating-system IME certification. This is a clean bounded QA round, not a claim that all possible defects are exhausted.

Run `pnpm test src/extensions/csv --maxWorkers=4`, `pnpm test --maxWorkers=4`, `pnpm typecheck`, and `pnpm build` from the worktree. The Glide dependency patch is part of this change and must be installed for browser reproduction.
