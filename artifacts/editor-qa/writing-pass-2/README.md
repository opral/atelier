# Markdown writing QA, second pass

Baseline for this pass: `b610cad`. Real Chromium smoke checks ran against the current working tree after writing fixes. The temporary editor harness imported production `MarkdownWc`, `History`, `TableNavigationExtension`, and the production paste handler; it exposed snapshots and dispatched clipboard paste events through ProseMirror. This tests real browser editing, without the full application shell or persistence.

Five browser scenarios passed with no page errors (full editor JSON/HTML/Markdown and Chromium version in `browser-results.json`):

- Paste `beautiful ` into `Hello |world`: one paragraph containing `Hello beautiful world`.
- Paste literal multiline Markdown-looking source into a code block: one code block, preserving whitespace and `#`, `-`, `**` syntax. See `literal-code-paste.png`.
- Shift+Enter inside code: inserts a newline within the same code block.
- Enter inside a table cell: inserts a hard break while retaining two rows and two columns. See `table-cell-enter.png`.
- Paste a heading and list into a table cell: retains the table and column count; clipboard text stays inside the cell.

The new `paste-writing-qa.test.ts` contains 14 passing regression cases covering prose/list/task/heading/table inline paste, boundary whitespace, code literals, whitespace replacement, mixed-block replacement, undo/redo, and three structured table paste variants. The original failures were reproduced before implementation: inline word paste created three paragraphs; code paste created four blocks; whitespace replaced a code block with a paragraph; heading/list/multiple-paragraph paste split a table into three or four document blocks.

Existing paste tests also passed (35 cases), and targeted lint passed. Persistence integration expectations for plain word paste at the beginning/end of a paragraph were updated to reflect inline insertion; the root agent runs the final integrated suite.

## Final integrated validation

- Added 43 regression cases: 14 paste, 10 keyboard, 10 Markdown bridge, 9 table navigation. Updated two persistence integration tests that previously expected plain word paste to create separate paragraphs.
- Final `pnpm test --maxWorkers=4`: 1,351 passed, 1 skipped, 1 failed (116 files). The only failure remains the Lix checkpoint snapshot test reproduced on untouched main in the first QA pass.
- Typecheck and production build pass. All changed files pass formatting; targeted lint passes. Unchanged repository-wide lint errors remain as documented in the first pass.
- A shell navigation test failed under high parallelism, then passed alone and in the final full run.
- Independent review caught and fixed table Enter/Shift-Enter dropping active bold formatting; both cases have regression tests.

## Remaining scope limits

Rich HTML-only clipboard import was inspected but is not implemented in this pass; the editor's schema largely lacks HTML parsing rules. Clipboard verification covers plain text/Markdown and the existing image path. Cross-cell range Enter/Shift-Enter is consumed without editing to protect table structure; this lightweight table schema does not implement spreadsheet-style multi-cell replacement. Browser checks use the actual editor extensions, not the complete application shell. Persistence integration tests exercise the inline paste behavior separately.
