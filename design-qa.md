# Colon-triggered emoji picker — design QA

## Comparison target

- Source editor reference: `/Users/samuel/Library/Application Support/CleanShot/media/media_nrflWwV7sT/CleanShot 2026-07-14 at 11.42.10@2x.png`.
- Existing command-hint reference: `artifacts/design-audit/19-empty-line-command-hint-focus.png`.
- Existing slash-menu visual system: `src/extensions/markdown/components/slash-command-menu.tsx` and the `.markdown-slash-*` rules in `src/extensions/markdown/style.css`.
- Implementation: `src/extensions/markdown/components/emoji-picker-menu.tsx`, `src/extensions/markdown/components/emoji-catalog.ts`, `src/extensions/markdown/editor/extensions/emoji-commands.ts`, and the `.markdown-emoji-*` rules in `src/extensions/markdown/style.css`.
- Intended viewport: desktop editor at the supplied 1000 × 730 crop, with the caret after `:` and after `:rocket`.
- Implementation screenshot: unavailable; the Codex in-app Browser runtime failed during connection with `Cannot redefine property: process` before a tab could be opened.

## Full-view comparison evidence

- The supplied editor screenshot and existing focused command-hint capture were opened and inspected.
- A browser-rendered implementation capture could not be produced, so no same-viewport side-by-side visual comparison is available.
- The picker shares the exact slash-menu shell, scroll region, group label, option row, selected state, icon tile, copy hierarchy, and footer classes. Emoji-specific CSS only adjusts the menu height, row height, color-emoji font stack, glyph size, and no-result message.

## Focused region comparison evidence

- Command hint: implementation keeps the existing placeholder typography and only extends the copy from `Press ‘/’ for commands` to `Press ‘/’ for commands · ‘:’ for emoji`.
- Picker: code-level comparison confirms the same 19rem width, 10px radius, border, panel token, shadows, backdrop blur, option spacing, selection tokens, and keyboard footer as the slash menu.
- Focused browser comparison is blocked because the implementation screenshot is unavailable.

## Required fidelity surfaces

- Fonts and typography: inherited directly from the slash palette; emoji glyphs use the platform color-emoji font stack. Browser rendering not visually confirmed.
- Spacing and layout rhythm: menu shell and row primitives are reused from the slash palette; the emoji row is 2.75rem high to keep eight search results compact. Browser rendering not visually confirmed.
- Colors and visual tokens: all panel, border, selection, icon-tile, and text colors reuse existing Atelier tokens. No new palette values were introduced.
- Image quality and asset fidelity: the feature renders native Unicode emoji, which is the content being selected; there are no placeholder images or simulated icons.
- Copy and content: `Popular emoji`, Unicode names, `:shortcode:`, `No emoji found`, and the existing `Navigate`, `Select`, and `Close` footer language are consistent and concise.

## Interaction evidence

- `:` at a text boundary opens the picker; prose, times, URLs, code blocks, inline code, and queries containing whitespace do not trigger it.
- Search covers 1,914 Unicode emoji with common aliases such as `thumbsup`, `+1`, and `tada`.
- Arrow navigation wraps, Enter and click insert, Escape and outside click close, focus returns to the editor, and no-result Enter remains available to the editor.
- Accessibility semantics include a named listbox, options, active descendant, selected state, and a polite live region.

## Automated validation

- Typecheck: passed.
- Production build: passed; the Unicode catalog is emitted as a lazy 30.60 kB gzip chunk.
- Full test suite: 72 files passed; 680 tests passed and 1 skipped.
- Consumer fixture build: passed after installing its missing workspace dependencies.
- Lint: passed with 10 pre-existing warnings and no errors.

## Findings

- P0: none found in automated interaction coverage.
- P1: visual verification is blocked because the implementation could not be rendered in the required in-app Browser.
- P2: none found in code-level comparison.
- P3: skin-tone variants are not expanded as separate results in this first version.

## Comparison history

1. The design was anchored to the existing slash-command palette rather than introducing a separate picker language.
2. Trigger detection was restricted to start-of-block or whitespace boundaries after reviewing the supplied document's prose and URL colons.
3. The initial popular set was paired with a lazy full Unicode catalog so the first menu is immediate without adding the catalog to the editor's primary bundle.
4. Automated interaction, type, lint, production build, and consumer build checks passed.
5. Browser capture was retried, but the in-app Browser connection failed before an implementation screenshot could be created.

## Implementation checklist

- No code fixes remain from automated review.
- Human visual review should confirm caret anchoring, emoji baseline alignment, eight-row menu density, above/below placement, and the expanded empty-line hint in light and dark themes.

final result: blocked
