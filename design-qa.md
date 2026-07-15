# Emoji picker entry points — design QA

## Comparison target

- User feedback capture: `/Users/samuel/Library/Application Support/CleanShot/media/media_jd91sCxjYo/CleanShot 2026-07-14 at 12.00.47@2x.png`.
- Correct original command-hint reference: `artifacts/design-audit/19-empty-line-command-hint-focus.png`.
- Existing slash-menu visual system: `src/extensions/markdown/components/slash-command-menu.tsx` and the `.markdown-slash-*` rules in `src/extensions/markdown/style.css`.
- Implementation: `src/extensions/markdown/editor/block-commands.ts`, `src/extensions/markdown/components/slash-command-menu.tsx`, `src/extensions/markdown/components/emoji-picker-menu.tsx`, and `src/extensions/markdown/editor/extensions/emoji-commands.ts`.
- Intended states: focused empty paragraph; `/emoji` filtered in the slash menu; emoji picker immediately after selecting `/emoji`; `:rocket` emoji search.
- Implementation screenshot: unavailable; the Codex in-app Browser runtime failed during connection with `Cannot redefine property: process` before a tab could be opened.

## Full-view comparison evidence

- The feedback screenshot and correct original command-hint capture were opened and inspected.
- The placeholder is restored exactly to `Press ‘/’ for commands`; it no longer advertises the `:` shortcut.
- A browser-rendered implementation capture could not be produced, so no same-viewport side-by-side visual comparison is available.

## Focused region comparison evidence

- Command hint: the production copy now exactly matches the original reference, with no typography or layout changes.
- Slash menu: `Emoji` appears in the existing Insert group with a Lucide Smile icon, the same option-row structure, and the description `Insert an emoji`.
- Picker handoff: selecting `/emoji` deletes the slash query, keeps the caret in place, and opens the same emoji palette. Typing filters directly in the document and selection replaces that query.
- Colon shortcut: `:` remains available silently and uses the same picker, preserving the original requested behavior without adding placeholder noise.
- Focused browser comparison is blocked because the implementation screenshot is unavailable.

## Required fidelity surfaces

- Fonts and typography: the placeholder reuses the unchanged editor placeholder styling; the new slash item inherits slash-menu typography.
- Spacing and layout rhythm: no placeholder dimensions changed; the new command uses the existing slash option and Insert group layout.
- Colors and visual tokens: no new colors were introduced; the command and picker inherit existing Atelier tokens.
- Image quality and asset fidelity: the slash item uses the repository's existing Lucide icon system, and the picker renders native Unicode emoji as selectable content.
- Copy and content: the hint is exactly `Press ‘/’ for commands`; slash copy is `Emoji` and `Insert an emoji`; picker labels remain Unicode names and shortcodes.

## Interaction evidence

- `/emoji` filters to the Emoji command, Enter opens the picker, typing `rocket` filters it, and Enter inserts 🚀.
- `:` still opens emoji search at a valid text boundary.
- Prose, times, URLs, code blocks, and inline code do not create false-positive colon triggers.
- Arrow navigation wraps, Enter and click insert, Escape and outside click close, focus returns to the editor, and no-result Enter remains available to the editor.
- Accessibility semantics include named slash and emoji listboxes, options, active descendants, selected states, and a polite live region.

## Automated validation

- Typecheck: passed.
- Production build: passed; the Unicode catalog remains a lazy 30.60 kB gzip chunk.
- Full test suite: 72 files passed; 683 tests passed and 1 skipped.
- Consumer fixture build: passed.
- Format check: passed.
- Lint: passed with 10 pre-existing warnings and no errors.

## Findings

- P0: none found in automated interaction coverage.
- P1: visual verification is blocked because the implementation could not be rendered in the required in-app Browser.
- P2: none found in code-level comparison.
- P3: skin-tone variants are not expanded as separate results in this first version.

## Comparison history

1. The initial implementation added `: for emoji` to the empty-line hint.
2. User feedback established that the original hint should remain visually unchanged.
3. The hint was restored exactly, while the existing `:` shortcut was kept silent.
4. Emoji was added to the slash menu's Insert group, with an explicit picker-open state so `/emoji` and `:` converge on the same component.
5. Automated interaction, type, lint, format, production build, and consumer build checks passed.
6. Browser capture was retried, but the in-app Browser connection failed before an implementation screenshot could be created.

## Implementation checklist

- No code fixes remain from automated review.
- Human visual review should confirm the original placeholder copy, the Emoji row in the Insert group, picker anchoring after `/emoji`, emoji baseline alignment, and light/dark appearance.

final result: blocked

---

# Files tree unified New menu — design QA

## Comparison target

- Approved design mock: `.codex/audits/file-tree/mocks/07-new-as-tree-row-review-mode.png`.
- Primary reference state: a compact, borderless `New` row in the file tree;
  its open menu has a selected destination, generic file/folder actions with
  shortcuts, and Markdown/CSV quick starts. A review-status dot is left of the
  row ellipsis.
- Implementation: `src/extensions/files/index.tsx` and
  `src/extensions/files/file-tree.tsx`.

## Implemented fidelity surfaces

- The compact trigger is a normal tree row (`New`, orange file-plus icon,
  discreet chevron), rather than a bordered button or toolbar.
- The flat menu begins with `New file` (`⌘ .`) and `New folder` (`⇧⌘ .`), then
  Markdown and CSV variants. It deliberately omits a `Create in:` destination
  label to keep the interaction light; existing asset icons preserve the
  repository's folder, Markdown, and CSV colors.
- Creation resolves to the selected folder, the selected file's parent, or
  root; generic names keep their supplied extension, while Markdown and CSV
  variants append their extension only once.
- Markdown and CSV drafts visibly begin as `.md` and `.csv` with the cursor
  before the extension. Generic `New file` begins empty and commits an
  extensionless name as typed—there is no hidden or implicit `.md` suffix.
- Per-row actions use the native tree right-click and hover/focus ellipsis
  affordance. Folder menus show the existing orange file-plus and blue folder
  icons for New file/New folder, followed by a clean text-only Rename row and a
  separated Delete action. Delete uses a compact filled trash icon at the
  tree-icon weight, neutral secondary text at rest, and the review-mode
  Backspace glyph in a `⌘ ⌫` keycap; the danger token appears only on hover or
  keyboard focus. File menus offer Rename and Delete; watched and
  checkpoint-diff rows remain non-destructive, with checkpoint rows retaining
  Open only.
- The upstream tree composition keeps the review-decoration lane before the
  action lane, so an amber review dot appears before the ellipsis without
  permanent action chrome.

## Interaction and automated evidence

- Focused Files tree tests: 52 passed. Coverage includes central New menu labels
  and shortcuts, selected-folder creation, the visible extension and caret
  position for Markdown/CSV drafts, extensionless generic-file creation,
  generic-extension collision handling, right-click, ellipsis, rename,
  icon-bearing create actions, the filled delete icon and semantic `⌘ ⌫`
  shortcut for files and folders (including active descendant views), checkpoint
  read-only behavior,
  watched-directory restrictions, and
  review-dot/action ordering.
- Full test suite: 780 passed, 1 skipped across 74 test files.
- Typecheck: passed.
- Production build: passed.
- Lint: passed with 10 pre-existing warnings and no errors.
- Scoped formatting and `git diff --check`: passed.

## Visual verification limitation

- The approved source mock was opened and inspected in this task.
- A same-viewport implementation screenshot could not be captured: the Codex
  in-app Browser runtime fails before opening a tab with
  `Cannot redefine property: process`. No alternate browser was used because
  no browser was selected for this task.
- This is an environment/tooling limitation, not a claimed visual pass. Review
  the open New-menu and row-ellipsis states in the PR preview before merge.

## Findings

- P0: none in automated interaction, type, lint, or production-build checks.
- P1: manual visual comparison remains required because the in-app Browser
  runtime could not initialize.
- P2: none.

final result: blocked — browser runtime unavailable for required screenshot comparison
