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
