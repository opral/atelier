# Design QA — Empty-line command hint

## Target

- Source truth: `/Users/samuel/Library/Application Support/CleanShot/media/media_fTOpgv0MD3/CleanShot 2026-07-11 at 12.23.28@2x.png`
- Full implementation capture: `artifacts/design-audit/18-empty-line-command-hint.png`
- Focused comparison capture: `artifacts/design-audit/19-empty-line-command-hint-focus.png`
- Viewport: 649 × 863, light theme, both side panels open
- State: a focused, empty paragraph immediately after a blank heading

## Comparison

The Notion reference and Atelier implementation were reviewed together in the same visual comparison input. Atelier intentionally adapts the reference copy to its available capability: `Press ‘/’ for commands` rather than advertising an unavailable AI shortcut.

### Findings and fixes

- P1 — The previous placeholder appeared only at the first document node. Fixed by styling every focused empty paragraph emitted by the Tiptap placeholder extension.
- P1 — The old `Start typing...` copy did not teach the slash menu. Replaced with the direct, capability-accurate command hint.
- P2 — The old placeholder treatment was italic and visually detached from the editor typography. Fixed with inherited 16px system sans, normal style, 400 weight, and quiet tertiary contrast.
- P2 — Discoverability needed to disappear the instant input begins. Verified that typing `/` removes the hint and opens the accessible `Slash commands` listbox.

### Final verification

- Copy: `Press ‘/’ for commands`.
- Typography: 16px font size, 25.6px line height, 400 weight, normal style.
- Color: tertiary gray (`rgb(120, 113, 108)`) at 0.72 opacity; visually consistent with the reference's low-emphasis helper text.
- Alignment: the hint begins at the active paragraph caret and shares the editor text column.
- Scope: the hint appears on a new empty paragraph anywhere in the document, not only in an empty document.
- Interaction: typing `/` removes the placeholder and opens the slash-command menu with the first option selected.
- Image quality: no raster or generated assets are involved; text remains native and crisp.
- Automated verification: 14 targeted editor tests, formatting, linting, TypeScript checks, and the production build passed.

## Final result

passed
