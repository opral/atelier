# Iterative Markdown QA: stopping report

Starting commit: `eeae883`. The requested loop ran until a complete fresh verification round across the tested workflows reported no newly discovered defects. This is a coverage-based stopping condition, not a claim that every possible editor interaction is bug-free.

## Findings and fixes

The first loop round and its follow-ups found three classes of asynchronous image-paste defects:

1. Image files inserted into table cells or across a cell range split the table into multiple document blocks. They now insert inline while retaining table rows and cells.
2. Removing a pending upload's containing block could relocate the image to an unrelated surviving caret. Removed containers invalidate the upload target and trigger asset cleanup; replacing text inside a surviving container still preserves the pending image.
3. An unmoved cross-cell selection could remain selected after the image arrived. It now collapses after the inserted image. A selection deliberately moved elsewhere while uploading is preserved.

An interim invalidation approach was corrected to distinguish replacing a wider text range from removing its containing block. The fresh verification cases include both.

## Loop results

- Round 5 source verification: 22 clean cases across edit/reload and unchanged-source preservation.
- Round 5 keyboard verification: 82 clean cases across range edits, collapsed boundaries, atoms, undo, and redo.
- Asset round: reproduced and fixed the defects above; expanded to 20 cases covering delayed upload, queue order, canceled/read-only/destroyed editors, deleted containers, larger text replacements, live caret/selection preservation, reload, undo, and redo.
- Fresh Round 6 source verification: 11 clean mixed-asset, table, reference, and empty-item cases.
- Fresh Round 6 keyboard verification: 23 clean image-selection, image-adjacent, table, code, and quote cases.
- Final fresh asset follow-up: moved selections and same-cell replacement/caret cases were clean, with all previous asynchronous cases still passing. No further production edits were needed.
- Native browser round: 22 clean composition cases across prose, heading, list, task, quote, code, formatting, links, and tables. A fresh follow-up added 6 clean forward/backward native-input, composition, cancellation, and undo cases.
- Browser asset verification: 3 clean delayed image-paste cases, including typing after insertion and separate undo steps, plus 1 clean deleted-target/asset-cleanup case.

Together, the fresh source, keyboard, asset, and native-input follow-ups yielded no new bugs. The loop stopped after those checks and final integrated validation.

## Final validation

- Added 158 automated cases across source, keyboard, and asset workflows.
- Full suite: `pnpm test --maxWorkers=4` — **1,615 passed, 1 skipped, 1 failed**, 129 files.
- The sole failure remains `lix-diff-commands.test.ts` / “sweeps the selected file's new directories into the checkpoint”, with `filesystem descriptor is missing its snapshot`. It was reproduced on untouched main in the first QA pass and is outside the Markdown editor changes.
- Production build, TypeScript typecheck, formatting, targeted lint, and diff whitespace checks pass.
- 32 Chromium checks passed. Browser version and document/undo snapshots are in the JSON files alongside this report. The browser harness used production editor extensions and the production image-paste handler, with controlled asynchronous asset storage. Its temporary files and server were removed after verification.

## Coverage limits

Browser checks exercise Chromium's editor and native composition machinery, with selections established programmatically and actual keyboard/clipboard events afterward. They do not cover the complete application shell visually, every OS/IME combination, mobile touch behavior, or rich HTML-only clipboard import. Existing integration tests cover persistence; browser asset storage was controlled rather than a live upload service.
