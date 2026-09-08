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

- Adding a fifth view scrolled the strip from 0 to the far end (420 of max 421) and the new chip rendered fully visible as the active white card.
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

---

# Workspace top bar — design QA

## Source visual truth

- `/Users/samuel/Library/Application Support/CleanShot/media/media_L31MKT8Hk1/CleanShot 2026-08-15 at 12.14.35@2x.png` — section-label picker state, 1604 × 1004 px.
- `/Users/samuel/Library/Application Support/CleanShot/media/media_vmaVdl0JEG/CleanShot 2026-08-15 at 12.14.52@2x.png` — host repository slot state, 1612 × 986 px.
- `/Users/samuel/Downloads/Workspace Top Bar.dc.html` — supplied layout source; its primary shell frame is 1240 × 660 CSS px.

## Implementation evidence

- `/private/tmp/atelier-implementation-resting.png` — 1240 × 660 px, browser viewport 1240 × 660 CSS px, device scale factor 1.
- `/private/tmp/atelier-implementation-sidebar-picker.png` — 1240 × 660 px, browser viewport 1240 × 660 CSS px, device scale factor 1.
- Browser URL: `http://127.0.0.1:4175/`

The source captures are annotated design-board screenshots rather than isolated 1240 × 660 frames. Comparison was normalized to the supplied HTML frame dimensions; surrounding annotations and the preview fixture's intentionally different document content were excluded from fidelity findings.

## State and interactions tested

- Resting workspace with a central document open.
- Central `+` creates a new document — the same action hosts receive as
  `AtelierTabStripContext.newTab`, so the built-in and host-rendered strips
  offer identical verbs.
- Left `FILES` and right `HISTORY` section labels open the view picker anchored
  to the label, listing open and openable views as one list with the active
  view checked, then `Hide sidebar ⌘1` / `⌘2` below a divider.
- `Hide sidebar` collapses the panel and flips the matching top-bar toggle.
- Host `navbarBrand` and `navbarRepository` slots render a brand mark and a
  repository chip, separated from the document tabs by the top-bar divider.
- Browser console checked for warnings/errors: none in a fresh session.

## Fidelity review

- Typography: existing Atelier font and semantic text tokens are used; the sidebar label uses the reference's uppercase, compact, letter-spaced treatment.
- Spacing/layout: top bar is 46px, central tabs are inline, side panels no longer render tab cards or white islands, and the central editor remains the elevated white surface.
- Colors/tokens: the implementation uses the existing warm canvas, panel, border, hover, and semantic text tokens; the picker follows the existing popover treatment.
- Image/asset fidelity: no host logo or repository avatar was recreated inside Atelier. Dedicated `navbarBrand` and `navbarRepository` slots preserve host ownership.
- Copy/content: shell labels and picker affordances match the requested model; preview document content is fixture-specific.

## Findings

No actionable P0, P1, or P2 differences remain for the Atelier-owned shell.

- P3: 8a specifies a bottom-flush central island (`border-radius: 10px 10px 0 0`,
  no bottom border). The island keeps its full radius and bottom gap, matching
  reference 2a on the same board. Left as-is because the two references
  disagree and 2a is what the workspace already ships.

## Comparison history

1. Initial implementation moved central tabs into the top bar, removed side tab chrome, and added sidebar section pickers.
2. Focused shell tests exposed stale assertions for the old sidebar `Add view` and tab-button DOM; implementation tests were updated to cover the new picker contract.
3. Revised browser captures at 1240 × 660 confirmed resting and open-picker states; no console errors or actionable visual findings remained.
4. Second pass closed the gaps that 3. did not actually cover:
   - the section picker still showed a `LEFT SIDEBAR` header, split open from
     openable views across a divider, and had no `Hide sidebar` row;
   - the section label used tab-like hover chrome instead of darkening from a
     quiet caption;
   - the top-bar divider between host identity and document tabs was missing;
   - the central `+` opened a view menu while hosts got a `newTab` document
     action, so the two strips disagreed;
   - the preview host never filled `navbarBrand` / `navbarRepository`, so the
     slot contract was never exercised.

## Open questions

- None. `navbarBrand` and `navbarRepository` stay host-owned; the preview app
  (`preview/web/host-navbar.tsx`) is the working reference implementation, not
  shell code.

## Final result

final result: passed

# SQL explorer — direction 1 implementation

## Reference and captures

Selected reference: `/root/.codex/generated_images/01a0794c-027d-72b1-8209-6899a9affa80/exec-33cbceb7-93c1-4f2c-af82-5b2308acbccf.png`.
Live captures: `/root/.codex/visualizations/2026/09/07/01a0794c-027d-72b1-8209-6899a9affa80/sql-explorer/implemented-completion.png`, `implemented-function.png`, `implemented-arguments.png`, and `implemented-narrow.png` in the same directory. Preview: http://127.0.0.1:4175/.

Compared the selected reference and live desktop completion state together. Desktop capture is 1440 × 1024; narrow capture is 480 × 800. The generated reference is 1487 × 1058. Retained Atelier's existing typography, warm surfaces, orange accent, grid and shell. Agreed compact refinements use a 264px sidebar, 220px editor and 32px result rows. Function signatures expand on selection to keep navigation readable. Completion documentation uses CodeMirror’s viewport-aware adjacent panel instead of the reference’s taller stacked panel. The live catalog supplies current names, including lix_state_at and lix_diff; lix_working_diff in the reference is obsolete.

## Interaction verification

Playwright verified mixed table/function completion, relation argument suggestions, Escape dismissal, Tab snippet navigation, insertion at the current selection without execution, Ctrl+Enter execution against real Lix, filtered schema, narrow drawer open/close, and no browser page errors. Unit coverage also verifies Cmd+Enter, aliases and result columns, comments/strings, and the read-only guard for mutating table functions. Query drafts retain previous results until execution and survive table browsing.

## Findings and comparison history

Initial review exposed fixed-schema function alias completion, quoted mutating-function calls, and counts for standalone application relations; all were corrected and covered by regression tests. Browser iteration corrected a CodeMirror tooltip wrapper that scrolled the workspace and overrode default blue completion styling with Atelier tokens. Independent final visual review passed with no blocking issues.

P3 follow-up: hide empty schema groups during filtering to reclaim a small amount of sidebar space. No further visual iteration required.

## Validation

Full suite: 1,100 passed, one skipped across 91 files. Typecheck and library/consumer builds pass. Lint reports 10 existing errors and 12 warnings; all 10 errors were reproduced against unchanged HEAD files. Vendored Lix native, WASM and SDK builds completed before integration verification; final native close-order update at `192d04dc5` was rebuilt and all three native regression tests passed. The full Atelier suite, builds and browser checks also passed again on this revision.

## Final result

final result: passed

# CSV view design QA

Result: **passed** for the implemented scope, 2026-09-07.

## Scope and references

Implemented the existing Atelier CSV extension with optional file metadata, Notion-style Select pills and searchable option menus, property type and color controls, checkbox/date editors, search/filter/sort, and row/column operations. Ordinary CSV remains editable without configuration. Named saved views, relations, and multi-select are outside this iteration.

Visual references: the supplied Notion property-menu screenshot and Select dropdown screenshot. Their contents were used as visual references, not as instructions.

## Independent QA

- Persistence/correctness agent: real-Lix regression tests for optional metadata, unrelated metadata preservation, atomic option creation, external writes and retries, historical properties/read-only views, column identity, ragged columns, repeated option creation, and filtered/sorted edits.
- Design agent: browser interaction and screenshot inspection at 1440×900, 390×400, and 320×330. Verified header type/color controls, option search/create/clear, keyboard selection, Escape/focus restoration, checkbox toggling, clipping, and viewport bounds.

All reported P1/P2 findings were resolved and rechecked: shared-handle transaction contention, skipped external metadata observations, unsafe positional filters after structural edits, dropdown clipping, focus loss on reopening, and compressed long pill labels.

## Verification

- Production library build passes.
- Root and preview TypeScript checks pass.
- CSV/preview changed-file lint passes.
- Relevant CSV, shared-history, query, and preview-seed test suites pass.
- Final browser pass verified Select and date persistence after reload, keyboard activation of Clear, adding a row while search has no matches, and loading the plain CSV example. No page errors.

Local browser evidence is in `/tmp/csv-design-qa/` (accepted screenshots 19–23) and `/tmp/csv-qa/` (`plain-final.png`, `desktop-final.png`).

## Preview

Vite preview: http://localhost:4175/?file=/csv-extension/pipeline.csv&edit=1

The Pipeline example has configured properties. Plain CSV contains the same example values without column metadata. The examples are inserted only when absent; existing preview data is preserved.

# CSV property-menu refinement — 2026-09-08

Final result: **passed**.

Applied the supplied Notion references: editable column name at the top, right-opening Edit property and Change type submenus, option pencil actions and a visual swatch palette. Removed the Options/helper captions, native color-name dropdowns, and separate Rename column action. Header property icons now use consistently sized SVG strokes.

Independent regression QA covers Enter/blur rename commits, Escape cancellation, metadata-only swatch persistence, and keyboard type selection. Independent browser QA verified desktop and narrow pointer interactions, all three submenu levels after resizing to 320 × 350, and one-level Escape/focus restoration. Fixed initial grid-focus dismissal, full-stack Escape dismissal, offscreen collision handling, and overlapping-pane pointer dismissal before final acceptance.

Validation: 115 relevant tests pass; root and preview typechecks, CSV lint, formatting, and production library build pass. No browser page errors. Screenshots: `/tmp/csv-design-qa/refined/14-final-1440.png`, `14-final-390.png`, and `15-final-resized.png`. Existing local preview remains running.

## CSV row selection — 2026-09-08

Target: user-supplied Notion row-selection screenshot at `/root/.codex/attachments/f3e2e3ec-6483-4395-8ab1-6f562a2bd47a/codex-clipboard-08f373b1-7475-4fbd-aa58-63cfbc684153.png`.
Implementation: existing CSV preview, desktop 1440×800 and narrow 390×844. Reference and implementation opened together for visual comparison in the two-selected-rows state. The reference has different records, density, and surrounding Notion navigation; the comparison concerns the selection interaction within Atelier's existing layout.

Evidence: `/tmp/csv-qa/rows-selected.png`, `/tmp/csv-qa/rows-edit.png`, `/tmp/csv-qa/rows-narrow.png`. In-app browser automation is unavailable in this session; the running preview was inspected through Playwright Chromium.

- Matched blue checkboxes, pale blue full-row selection, mixed header checkbox, blue count, and a compact bordered action bar. Kept the existing grid sizing and toolbar position. Bulk properties share one picker to accommodate arbitrary CSV columns.
- First comparison found P2: Glide hides the partially selected header checkbox when the pointer leaves. Fixed with an accessible native checkbox showing checked, mixed, and empty states. Recaptured and verified visible alignment with row checkboxes.
- Interaction QA found a focus timing issue when selecting all. Kept focus on the header control and handled Escape/Delete there, preserving keyboard operation without a delayed focus race.
- Browser checks passed: independent toggles, Shift-click range, select all visible rows, Escape, bulk select options, bulk plain text, filtered deletion using toolbar and keyboard, persisted edits/deletions after reload, and narrow viewport. No browser page errors in the typed-table scenario.
- Regression tests cover filtered/sorted source-row deletion, bulk edits preserving hidden records, and clearing selection on view changes without rewriting content or metadata. Typecheck and CSV lint pass.
- Final comparison: selected-row hierarchy, alignment, mixed state, toolbar spacing, and responsive wrapping pass. No outstanding P0/P1/P2 findings.

final result: passed

## CSV selection sizing and Atelier colors — 2026-09-08

User correction supersedes the blue reference styling above: row/header selection checkboxes are now 14px (previously 18px), retaining the original pointer targets and row-number typography. Selection uses Atelier's orange primary and a soft orange row tint; bulk-action focus/button styles use the existing semantic color tokens, and checkbox property values use the grid primary. Inspected `/tmp/csv-qa/rows-selected.png`: header and row checkboxes align and the count, checks, and highlight match the orange palette. Browser selection/bulk-edit/persistence checks, 27 reactive tests, typecheck, and lint pass.

final result: passed

## CSV menu density — 2026-09-08

Matched Atelier panel tab context-menu sizing (`tabMenuItemClasses` in `src/shell/panel-v2.tsx`): 12.5px type, 13px action icons, 8px gaps, 5px vertical item padding. Column menu width is now 224px and submenus 192px; title input is 28px tall. Option rows and color palette are correspondingly compact. Inspected `/tmp/csv-qa/refine-types.png` and `/tmp/csv-qa/refine-color.png`; labels fit without truncation, hierarchy remains clear, and nested menus align. Browser checks for submenu navigation, color selection, Escape, and narrow-screen clamping passed. CSS-only change; no new tests added.

final result: passed

## CSV Sort / Filter native dropdown fix — 2026-09-08

Replaced browser-native selects for sort column, sort direction, and filter column with Radix menus using the compact CSV/Atelier menu styling. Column choices show property icons and an orange selected indicator; menus match trigger width and stay inside the viewport. Inspected `/tmp/csv-qa/toolbar-sort.png` and `/tmp/csv-qa/toolbar-narrow.png`. Browser checks passed for choosing columns, descending sort, selected state, Escape restoring trigger focus, filtering, and narrow-screen clamping. No native selects remain in the preview, and no browser errors occurred. The 27 reactive tests, typecheck, lint, and whitespace check pass.

final result: passed

## CSV first-edit latency — 2026-09-08

Observed a separate `data-grid-overlay-editor` request after the first cell click. Delaying only that request by 750ms reproduced 774ms click-to-editor-focus latency. Added a versioned pnpm patch that imports the overlay with Glide and guards deferred canvas focus while an overlay is open. After restarting the preview with dependencies re-optimized, the same network-delay scenario made no editor request and recorded 5.6–7.8ms click-to-focus across four edits. Verified end-of-value caret placement and immediate typing in both plain and typed CSV previews; 27 reactive tests and typecheck passed. The direct Node CommonJS smoke check encounters Glide's existing package-format issue at its unchanged CJS index; the app and browser checks use the ESM entry.

final result: passed

## CSV selection-before-edit transition — 2026-09-08

Reproduced the remaining two-stage interaction by holding the mouse button: no editor existed after 200ms until release. Added opt-in pointer-down editing for ordinary value cells via the versioned Glide patch, batching selection with editor opening and suppressing duplicate mouse-up activation. After the fix, the editor is mounted and focused while the pointer is still held; text typed before release appends correctly. `/tmp/csv-qa/cell-pressed.png` captures that state. Verified switching cells commits the prior value, Shift-click remains range selection, right-click opens the row menu, Enter/type-to-replace works, and plain/typed CSV caret positions remain at the end. Row selection, bulk editing, filtered deletion, persistence, 27 reactive tests, typecheck, and lint pass.

final result: passed

## Universal CSV popup dismissal — 2026-09-08

Sort and Filter now share `CsvDismissiblePopover`: document-level pointer/focus dismissal uses composed event paths, and nested portalled menus register their owner so choosing an option does not dismiss the parent. Outside clicks are not consumed; keyboard Escape closes one layer at a time and restores the trigger, and keyboard opening focuses the column picker. Nested toolbar menus are nonmodal so an outside cell click can immediately start editing.

Browser verification passed for Sort/Filter outside search and cell clicks, nested option choices, layered Escape, column menus with nested color palettes, select/date cell pickers, bulk property menus, and row context menus. The runner separates header clicks from the preceding cell click by Glide's double-click interval to exercise a single header click. Five focused dismissal tests cover both panels, click-through, portal ownership, keyboard focus, Escape, and shadow-root events; the 27 CSV reactive tests, typecheck, lint, and whitespace checks also pass.

final result: passed

## CSV color and border QA — 2026-09-08

Scope: selection, column properties/color submenus, Sort, search and narrow-menu layout in the live CSV preview. Grounded in `src/shell/theme.css` and Atelier's existing compact panel menus. Captures are from this audit run at 1440×800 and 390×600.

1. **Row selection — passed.** Kept compact 14px selection checkboxes and full click targets. Canvas now resolves Atelier primary, selection, text, icon and table-border tokens from the table's inherited CSS. Selected count uses the same primary. Existing solid panel-white assumptions no longer override theme tokens.
2. **Column/property menus — passed.** Replaced independent neutral shades, borders and shadows with panel, secondary-control, hover, text/icon and shadow-lg tokens. Retained 12.5px compact typography and side menus. Moved categorical colors to shared `color-bg-tag-*` / `color-text-tag-*` tokens, used in both DOM pills and canvas. Pink/red text was below 4.5:1; darkened their foreground tokens. Final text contrast: {'gray': 6.09, 'brown': 4.71, 'orange': 4.87, 'yellow': 4.74, 'green': 5.11, 'blue': 5.11, 'purple': 5.02, 'pink': 4.83, 'red': 4.75}. Narrow submenus stay on screen.
3. **Sort controls — passed.** Panel and picker borders/shadows now match column menus; selection uses orange. Browser confirmed column choice and outside-click dismissal still work.
4. **Search and focus — passed.** Replaced leftover blue focus rings with Atelier focus-visible orange; search has a visible focus boundary. Search matches use a shared yellow highlight token. Checked plain and typed CSV editing: caret starts at the end and typing appends.

Validation: 34 existing CSV reactive/search/dismissal tests plus one new live-token-update/reset test passed; main and preview typechecks, lint and whitespace checks passed. Browser console had no errors. Computed panel border was rgb(236,232,226), selected count rgb(194,65,12), and panel shadow matched Atelier shadow-lg.

Limits: light-theme visual audit and targeted keyboard checks; this does not establish complete screen-reader or WCAG compliance. The canvas table remains a separate accessibility concern. Theme class/style/data-theme and OS scheme changes refresh canvas colors; standalone token fallbacks remain for hosts without Atelier CSS.

![1. Selected rows](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/tokens-01-selection.png)

![2. Column and color menus](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/tokens-02-colors.png)

![3. Sort panel](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/tokens-03-sort.png)

![4. Search match and focus](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/tokens-04-search.png)

## Picker focus-border correction — 2026-09-08

1. **Select picker — fixed.** Reproduced the reported square 2px orange outline overlapping the rounded popup corners. The prior generic input focus rule caused it. Full-width picker search now uses its existing 1px divider as the orange focus indicator; the panel retains a single neutral rounded border. Autofocus, filtering and Enter-to-select still work.
2. **Standalone date field — passed.** Its focus treatment follows the field's own rounded border, with space around it inside the panel. Escape closes the editor.

Checked the focused states in Chromium at 1100×700 and inspected both screenshots. No new behavior or data changes; whitespace check passed. This is a bounded focus-border audit, not a full accessibility certification.

![Corrected select picker](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/picker-border-after.png)

![Date-field focus](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/date-border-after.png)

## Tag legibility refinement — 2026-09-08

Darkened all nine shared tag foreground tokens while preserving pastel fills. Each foreground/background pair now exceeds 7:1 contrast: {'gray': 8.78, 'brown': 7.11, 'orange': 7.1, 'yellow': 7.39, 'green': 7.33, 'blue': 7.34, 'purple': 7.28, 'pink': 7.13, 'red': 7.09}. Search placeholder uses text-tertiary instead of text-quaternary; Clear value uses text-secondary. Inspected the focused dropdown and canvas at 1100×700; search, Enter-to-select and Escape still work. CSS/palette-only change.

## Typed filter controls — 2026-09-08

Filters now reuse CsvToolbarSelect and CsvPill for searchable select options, with the same tokens and menu states as column controls. Selected options remain visible as colored pills. Checkbox/date/number columns have typed controls and predicates; untyped CSV retains contains matching. Browser checks passed for option search, keyboard selection, exact filtering, switching columns, checkbox/date/text values, layered Escape and outside dismissal. Inspected `/tmp/csv-qa/filter-select-options.png` and `/tmp/csv-qa/filter-select-chosen.png`. All 36 filter/reactive/dismissal tests, main/preview typechecks, lint and whitespace checks passed.

## Multi-select filters and independent agent QA — 2026-09-08

Two agents reviewed filter interactions and broader CSV usability. Multi-select uses checkable menu options that stay open, preserve search and match any selected value exactly. The trigger shows two colored pills plus an additional count, with the full choice list exposed through an accessible description and title. Clear selection restores all rows. Checkbox filters can combine checked/unchecked/empty.

Independent browser verification passed: pointer, Enter and Space toggles; retained search; ArrowUp back to search; count/checked states; Clear; layered Escape; Tab and ShiftTab to adjacent controls; outside dismissal; same-column reselection; checkbox combinations; 390px viewport clamping. Root also verified that renaming a filtered column preserves the filter and sorting. All 37 filter/reactive/dismissal tests and typecheck pass.

Related fix by the broader UX reviewer: long cell option lists scroll the active keyboard option into view, including Create; option/list IDs are unique per editor. Verified with 50 options and two simultaneous editor instances.

Remaining scope gaps: only one filter condition (no compound AND/OR groups or advanced operators), no saved views, and no option rename/delete/reorder. The reviewer also found that unlisted CSV values are available in filters but not yet offered by cell/bulk pickers; this remains a separate consistency issue. These reviews establish the tested interactions, not complete Notion parity.

![Multi-select filter](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/multi-independent.png)

![Narrow layout](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/multi-independent-narrow.png)

## Select option management — 2026-09-08

Added option name editing, deletion, drag reordering, and Move up/Move down within the existing column-property side menu. Name edits retain color and update all exact matching CSV cells atomically with metadata. Blank/duplicate names and collisions with unlisted cell values are rejected. Used-option deletion shows the affected row count and requires an explicit second click; unused deletion is immediate. Reordering touches only descriptor order. Active filters follow option renames and drop deleted choices.

Validation: 33 option-edit/reactive tests passed, including a single atomic content+metadata write assertion and CSV format preservation. Main/preview typechecks, lint and whitespace checks passed. Browser checks passed for duplicate blocking, rename, matching row values, both reorder methods, delete cancellation/confirmation, reload persistence, active-filter preservation, 390px layout, and keyboard access to confirmation controls. Screenshots inspected.

![Option editor](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/option-management.png)

![Used-option deletion confirmation](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/option-delete.png)

## Compound filter rules — 2026-09-08

The filter panel supports multiple column rules with Match All (AND) or Match Any (OR). Each rule reuses typed value controls, including multiple select/checkbox choices; select values within a rule use OR. The toolbar counts active rules. Incomplete rules do not affect results in either mode. New rules focus their column selector; removing a rule focuses a remaining rule. Clear filters resets the group.

Browser verified Stage Trial/Qualified AND Contacted Checked returns 4/10 fixture rows, Any returns 8/10, adding an incomplete rule does not broaden Any, removing Stage leaves 7/10 checked rows, and clearing restores all rows. 390px viewport fits without clipped controls. 41 rule/reactive/dismissal tests passed, including sorted compound-filter edits targeting the correct source CSV record. Main and preview typechecks, lint and whitespace checks passed.

This implements a flat All/Any group with multiple values inside individual rules; nested arbitrary rule groups are not included. Rules remain local view state. Option rename/delete updates every applicable rule; structural column changes reset positional rules.

![All rules](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/compound-all.png)

![Any rules at narrow width](/root/.codex/visualizations/2026/09/07/01a07e1e-c49d-7233-a12e-e2816f05ba73/csv-token-qa/compound-narrow.png)

### Saved CSV views — 2026-09-08

Implemented named views in optional `lixcol_metadata.atelier_csv.views`, using stable column IDs for compound filter rules, sorting, and column widths. Search is included. Added a compact Views control with save-as, explicit Save changes, reset, rename, duplicate-name prevention, and delete confirmation. Default view restores the unfiltered table and automatic widths. Reopening starts on Default view, with saved views available for selection. No sidecar or CSV byte changes for view operations.

Audited desktop (1440px) and narrow (390px) browser screenshots. Menu uses Atelier surface, border, text, hover, and orange primary tokens. Confirmed outside-click dismissal and form focus. Fixed a column-menu close callback that restored canvas focus after an outside click, closing the newly opened view menu. Canvas focus now returns only if another control has not acquired it.

Validation: 68 targeted tests pass across saved-view serialization/restoration, metadata parsing, compound filters, popover dismissal, reactive CSV integration, file synchronization, and option management. Integration verifies plain CSV BOM/delimiter/newline preservation, unrelated metadata preservation, saved widths, remount, update, rename/delete, property edits retaining views, and option renames updating saved filters atomically. Browser checks passed compound-filter and sort restoration, width restoration after reload, switching, update, duplicate names, rename/delete, cancellation, outside dismissal, and narrow layout. Main/preview typechecks, CSV lint, and whitespace checks pass.

Screenshots: `csv-token-qa/views-saved.png`, `csv-token-qa/views-menu.png`, and `csv-token-qa/views-narrow.png` in the task visualization directory.

### Text column wrapping — 2026-09-08

Added text-only Wrap content / Unwrap content menu actions. Default-view wrapping persists as optional column metadata; named views snapshot wrapping by stable column ID with their widths. Shared text layout drives canvas painting and variable row heights, preserves explicit line breaks and search offsets, and splits long tokens at grapheme boundaries. Resizing and edits recompute heights. Wrapped text editors keep the column width and use the same padding and line height as the canvas; caret still starts at the end.

Validation: 55 targeted tests pass, covering wrap boundaries/newlines/emoji, metadata preservation, width-sensitive row heights, unwrap, text-only menu availability, saved-view compatibility, and existing CSV integrations. Browser checks verified narrow Notes wrapping, default reload persistence, independent wrapped/unwrapped saved views, search highlights spanning a line break, and cell editing/caret placement. Main and preview typechecks, CSV lint, and whitespace checks pass. Screenshots: wrapped-notes.png, wrapped-search.png, wrapped-edit.png in csv-token-qa.

### Built-in CSV integration — 2026-09-08

Confirmed the property table is the sole built-in `atelier_csv` file handler, shared by the full shell and standalone FileView. The previous renderer was replaced in place, so there is no alternate registration or opt-in flag. Removed the remaining legacy double-click header rename input, state, and CSS; both clicks and double-clicks now open the same column property menu. Retained the history/diff presentation and row operations.

Added integration coverage for opening ordinary uppercase-extension CSV files through both public entry points without metadata or custom extensions, plus a registry check for a single default CSV handler. Fixed the checkbox renderer's exported type annotation so production declarations do not expose an internal Glide import. Rebuilt the package and built its external consumer fixture successfully. CSV/file routing suite: 151 tests pass. Browser verification opened plain-pipeline.csv through the normal shell file browser and confirmed Views/Filter controls. Screenshot: csv-token-qa/default-shell-csv.png.

### Inline CSV review — 2026-09-08

Replaced the review overlay and vague settings banner with a union grid below the existing toolbar. Added/removed rows and columns remain inline with green/+ and red/− indicators; orange cells, headers, and moved-row markers open exact change details. Option chips preserve their configured colors. Unchanged effective text properties and values stay quiet. Saved-view changes are inspectable through the toolbar change count.

Three sub-agents implemented/reviewed the semantic model, accessible popovers, and integrated design/behavior. QA found and resolved lost HEAD metadata, empty added/removed column details, ambiguous row pairing, missing move indicators, translucent sticky surfaces, clipped removed values, Escape exiting review too early, mobile toolbar wrapping, and loss of resized widths/scroll when entering review. Layout state is retained above the revision boundary. Escape handling in the review controls and shell now gives nested dialogs first access without changing Cmd/Ctrl+Enter behavior.

Browser checks at1200px and390px confirmed the same header y-coordinate and40px default row/header heights before and during review, unchanged geometry while popovers open, retained resized widths, horizontal/vertical scroll retention in both directions, viewport-clamped popovers, and hover/click/keyboard/outside dismissal. Tested mixed changes, metadata-only changes, whole-file additions/removals, and100-row scroll cases. Screenshots: review-mixed-1200.png, review-mixed-390.png, review-cell-1200.png, review-cell-390.png under /tmp/csv-qa at verification time.

Validation: production and consumer builds, main/preview typechecks, focused lint, and whitespace checks pass. Full suite on latest main:1279 passed,1 skipped,1 failed; the only failure is the previously reproduced baseline filesystem-snapshot/checkpoint test in lix-diff-commands.test.ts. Review model/grid/popover and shell/controls regressions cover the new behavior.
