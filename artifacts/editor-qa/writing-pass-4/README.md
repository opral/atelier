# Markdown writing QA, fourth pass

Baseline: `e2bdd17`. This pass investigated clipboard/image edges, Unicode word deletion, Markdown source preservation, and native composition input.

## Confirmed fixes

- Copying text beside inline images inferred whitespace across the image boundary, adding spaces. Boundary whitespace now comes only from actual boundary text nodes.
- Pasting an image-only inline fragment promoted it to a block and split the sentence. Inline fragments now remain inline and retain selected boundary spaces; complete image-block copies remain blocks.
- Word deletion treated hard breaks and inline atoms as part of one word, deleting preceding text. Inline leaf boundaries now stop deletion.
- Escaped or entity-encoded task-marker text was decoded and converted to a checkbox. Task recovery now verifies the original source syntax.
- Reference definitions inside edited containers could disappear. Definitions are retained with valid detached syntax when needed; unchanged definitions keep their spelling without duplication.
- A first native IME composition could duplicate the committed characters when node ID assignment replaced the composition DOM target. IDs are now assigned before composition begins, outside undo history.
- Native composition and native insertText replacing a range across table cells bypassed keyboard-only handling and could merge rows or add columns. Native input handlers now replace only the selected inline contents. Read-only editors remain unchanged.

## Browser evidence

Five Chromium scenarios passed using CDP `Input.imeSetComposition` followed by `Input.insertText`, exercising the browser's native composition machinery. Composition was updated from `漢` to `漢字` before commit. Each scenario also passed one-step Ctrl+Z restoration:

1. First composition in a pristine table cell.
2. Composition over text selected across four table cells.
3. First composition in a paragraph.
4. First composition in a code block.
5. Native insertText replacement across four table cells.

`browser-results.json` contains the browser version, before/after documents and JSON, undo results, and page errors (none). `ime-table.png` shows the retained 2×2 table after composition.

Before the fixes, a pristine cell produced `al漢漢pha` instead of `al漢pha`; cross-cell composition collapsed the 2×2 table to one cell; native insertText produced a mismatched extra column. The final checks require one committed sequence, valid schema, unchanged table dimensions, and successful undo.

The temporary Vite harness loaded production MarkdownWc, TableNavigationExtension, History, and Markdown conversion. Browser checks cover editor behavior, not the complete shell or physical OS input-method UI. Other IME engines/mobile devices were not tested. The temporary harness was removed after verification.

## Automated verification

- 48 new tests: 17 source preservation, 14 keyboard/identity, 10 clipboard/image, 7 native table input.
- Full suite (`pnpm test --maxWorkers=4`): 1,457 passed, 1 skipped, 1 failed across 124 files. The sole failure is the Lix checkpoint snapshot test reproduced on untouched main in the first pass.
- Production build and typecheck pass.
- Changed files pass formatting and targeted lint; four existing no-shadow warnings remain in shortcuts.ts.
