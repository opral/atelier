# List keyboard browser QA

Baseline: `origin/main` commit `56aa863`. Fixed: working tree containing the list schema, outdent, numbering, and empty-item parsing corrections. Executed in real headless Chromium with Playwright; see `browser-matrix.json` for browser version and asserted outputs.

## Exact reproduction

Load this Markdown, place the caret at the end of the child text, then press Enter once to create the empty nested item shown in the report:

```markdown
# Ideas

<span></span>

- Rapid API but for coding agents
  - rapid api is outdated. api's are massively more impactful for coding agents
```

The `*-0-enter.png` images capture that starting state. Press Enter on the empty nested item (`*-1-enter.png`), then Enter again (`*-2-enter.png`). `baseline.json` and `fixed.json` capture the editor document, serialized Markdown, rendered HTML, and selection for all three states.

On baseline the first Enter inserts a bare list item inside another list item. The second Enter removes the original parent's bullet, matching the report. With the fix, the first Enter lifts only the empty item to the outer list; the second exits that item to a paragraph. Parent text remains a bullet and its populated child stays nested.

## Browser assertions

Eleven scenarios passed, with no page errors:

- Bullet, ordered, checked task, and mixed nested lists: create empty child; Enter to lift; Enter to exit; type after the list; undo typing; redo typing. Assert original parent and child text and hierarchy remain intact.
- Shift+Tab on populated child: lift child to outer list while preserving parent.
- Backspace on empty nested sibling: remove only the empty sibling.
- Load and type into five empty-item forms: bullet, ordered, task, nested bullet, nested ordered. Assert valid ProseMirror content and successful typing.

## Scope and reproduction environment

A temporary Vite harness loaded the actual repository `MarkdownWc` extensions, `History`, `parseMarkdown`, `astToTiptapDoc`, and `serializeTiptapDocToMarkdown`. Playwright sent real browser keyboard events. The harness used simple CSS for readable screenshots and exposed editor snapshots; it did not mount the complete Atelier shell or exercise Lix persistence. Maintained unit/integration regression tests in the source tree cover the editor behavior; this directory contains browser evidence rather than an additional test runner. Screenshots are editor-only evidence, not full application visual QA.

## Automated validation

- Full suite: 1,308 passed, 1 skipped, 1 failed. The failure is `lix-diff-commands.test.ts` / “sweeps the selected file's new directories into the checkpoint” with `filesystem descriptor is missing its snapshot`; reproduced on untouched `56aa863` using the same SDK build.
- Build and TypeScript typecheck passed. Changed bridge files pass formatting and targeted lint (existing shortcut warnings remain). Repository lint has the same 14 errors and 7 warnings on untouched main.
- An intermediate full run had two `file-view.test.tsx` timing failures; the file passed alone and the final full run passed both cases.
- 29 added regression cases cover Enter, outdent, schema constraints, loaded empty items, hard breaks, selection direction, task state, numbering, stable identities, undo/redo, and Markdown reload.
