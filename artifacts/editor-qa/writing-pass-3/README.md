# Markdown writing QA, third pass

Real Chromium smoke checks ran against the working tree based on `82cc797`, using production `MarkdownWc`, `TableNavigationExtension`, and `History` in a temporary Vite harness. Keyboard input and undo used Playwright's real browser keyboard. Fixtures and range/NodeSelection setup used editor commands.

All nine recorded snapshots passed; there were no page errors. Full editor JSON, HTML, Markdown, selection snapshots, and Chromium version are in `browser-results.json`.

- Bold survives Enter followed by typing in a new paragraph (`bold-enter.png`).
- Enter on a selected divider preserves the divider and moves into a paragraph.
- Triple-newline code exit creates a paragraph; one Ctrl+Z restores the original code including trailing newlines.
- Backspace at a cell start and Delete at a cell end preserve all text and the 2×2 table shape.
- Delete across four cells clears selected text while preserving all four cells (`cross-cell-delete.png`).
- Enter across four cells replaces selected text with a hard break in the first cell and preserves table shape.
- Typing `X` across four selected cells replaces their text and retains the 2×2 shape.

Scope: these checks exercise the actual editor extensions in Chromium, not the complete application shell or persistence. No baseline browser comparison was run in this pass; the defects were reproduced by regression tests before their fixes. The temporary harness was removed after the run.

## Integrated validation and fixes

- Added 58 regression cases: 19 Markdown preservation, 15 clipboard, 12 keyboard/formatting, and 12 table selection. Updated two table Enter expectations from the previous defensive no-op to actual text replacement without merging cells.
- `pnpm test --maxWorkers=4`: 1,409 passed, 1 skipped, 1 failed across 120 files. The only failure is the existing Lix checkpoint snapshot failure already reproduced on untouched main during the first pass.
- Production build and TypeScript typecheck pass. Changed files pass formatting and targeted lint; four existing no-shadow warnings remain in shortcuts.ts.
- Clipboard regression tests exercise production serialization, cut events, persisted-editor setup, and undo. Inline fragments now preserve spaces, marks, links, and images without heading/code wrappers; paste is independent from surrounding typing in undo history. Cross-cell cut/paste preserves cells.
- Markdown preservation fixes cover nested strikethrough, formatted inline code, and linked images.
- Table cells are isolated from generic block joins. Cross-cell delete, typing, Enter, paste, and cut replace selected inline contents while retaining the table. Whole-table node deletion remains supported. This supersedes the cross-cell Enter limitation documented in pass 2.

Remaining scope: rich HTML-only clipboard import, mobile/IME-specific interaction, and full-shell visual QA were not part of this round. Browser table fixtures used programmatically established selections followed by real keyboard input.
