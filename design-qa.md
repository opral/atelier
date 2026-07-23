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
  keyboard focus. File menus offer Rename and Delete; watched rows remain
  non-destructive and retain Open only.
- The upstream tree composition keeps the review-decoration lane before the
  action lane, so an amber review dot appears before the ellipsis without
  permanent action chrome.
- The compact `New` chevron and tree overflow action share the same right-hand
  action column. The overflow icon is a lighter 12px ellipsis in the shared
  tertiary-icon token and appears only while its row is hovered (or while its
  menu is open).
- Pierre's native drag-and-drop interaction now moves Lix-backed files and
  folders into a Lix-backed destination folder while retaining the item's name.
  Its existing drag preview, target state, hover-to-open, and auto-scroll are
  used directly; drafts and watched entries are not draggable, and external
  file drops remain imports rather than moves.

## Interaction and automated evidence

- Focused Files tree tests: 59 passed. Coverage includes central New menu labels
  and shortcuts, selected-folder creation, the visible extension and caret
  position for Markdown/CSV drafts, extensionless generic-file creation,
  generic-extension collision handling, right-click, ellipsis, rename,
  icon-bearing create actions, the filled delete icon and semantic `⌘ ⌫`
  shortcut for files and folders (including active descendant views),
  watched-directory restrictions, review-dot/action ordering, native
  file/folder drag requests, Lix persistence, descendant path cascades, and
  active-file path remapping.
- Full test suite: 787 passed, 1 skipped across 74 test files.
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

---

# Panel tab strip overflow — design QA

## Comparison target

- User feedback capture: sidebar tabs ("Files", "History") clipped mid-chip at
  the panel edge; adding a view does not reveal the new tab; the chip row lacks
  affordance that it belongs to the sidebar when the canvas around it is empty.
- Implementation: `src/shell/panel-v2.tsx` (`TabBar`, `tabStateClasses`) and
  `src/shell/panel.module.css`.

## Reproduction evidence

- Reproduced in the running web preview (in-app Browser, `pnpm dev`) by
  injecting a multi-view left panel through the session-state store: with four
  views, the strip clipped chips hard at both edges, the 2px scroll thumb was
  the only overflow cue (auto-hidden after 250ms), and a newly added view
  landed offscreen because tab focus uses `preventScroll` and nothing scrolled
  the strip.

## Changes

- Overflow fades: 16px gradients from `--color-bg-app` at either strip edge,
  toggled by `data-overflow-left/right` on the tab bar. A half-visible chip now
  dissolves into the canvas and reads as "more tabs this way" instead of a
  rendering glitch.
- Active-tab visibility: a layout effect scrolls the active tab's chip into
  view whenever the active instance changes — covering add-view, selecting a
  clipped chip, and session restore (instant on first layout, smooth
  afterwards). A 28px margin leaves the neighboring chip peeking, and only
  widens a scroll that is needed anyway — a fully visible tab never triggers
  scrolling. Guarded per instance so re-renders never fight a manual scroll.
- Compact side-panel chips via progressive disclosure: the close X no longer
  reserves chip width at rest. On hover or keyboard focus it appears as a
  small circular badge floating over the chip's top-right corner (white
  fill, panel border, soft shadow), so the label stays fully readable. The
  badge is neutral in every tab state — tertiary-gray X, deepening with a
  soft hover fill on the badge itself; the whole 14px circle is the click
  target. Chip padding tightened from 12px to 10px per side. A "Files" chip
  shrinks from 92px to 69px.
- Central document tabs keep the familiar always-visible inline X
  (`closeOnHoverOnly` is set per panel side), with the neutral gray icon
  colors — the accent-colored X on the focused tab was dropped as redundant.

## Iterations on user feedback

1. First pass added a faint canvas tint to idle chips as the tab-group
   affordance; feedback: too strong.
2. Second pass replaced it with Notion-style icon-collapse for inactive
   side-panel tabs; feedback: felt weird, undone.
3. Final: idle chips return to text-only rest styling; the space win comes
   from removing the resting close X (progressive disclosure) and tighter
   padding, alongside the fades and scroll-into-view behavior.

## Interaction evidence (in-app Browser, live preview)

- Adding a fifth view scrolled the strip from 0 to the far end (420 of max
  421) and the new chip rendered fully visible as the active white card.
- Selecting a clipped chip smooth-scrolled it fully into view with the peek
  margin.
- Manual scroll away from the active chip survives unrelated re-renders and
  focus changes (no snap-back).
- Left/right fades appear only when scrollable in that direction; none at rest
  when all chips fit.
- Hovering a side-panel chip reveals the close badge at the chip's top-right
  corner without covering the label; resting chips show icon + label only;
  chip width does not change on hover.
- Central document tabs verified with two open documents: inline X visible
  at rest on active and idle chips, side-panel chip stays compact alongside.
- No console errors.

## Automated validation

- All shell tests (11 files): 89 passed.
- Full suite: 898 passed, 1 skipped, 1 failed —
  `state-adapters > createLixBranchSession > tracks branch switches made
  directly on Lix` also fails on a clean tree (pre-existing, unrelated).
- Typecheck: passed. Formatted with the repo's `oxfmt`.

## Findings

- P0: none.
- P2: dark mode currently only overrides shadcn tokens, not the atelier shell
  tokens; the new fade and close-overlay backdrop use the same shell tokens as
  the rest of the strip and will follow any future dark token work.
- P3: the 2px scroll thumb indicator remains; with the fades it is secondary
  and could be removed later if deemed redundant.
- P3: the close badge overhangs the chip by 4px on the right; a last chip
  sitting exactly flush with the strip edge would have the overhang clipped
  (in practice the add-view button follows the last chip).

final result: pass — verified live in the in-app Browser
