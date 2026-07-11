# Flashtype frontmatter flows 2a, 2b, and 2c — design QA

## Comparison target

- Supplied source: `/Users/samuel/Downloads/Flashtype Frontmatter.dc.html`
- Local reference: `preview/web/mocks/frontmatter-ux/flashtype-reference.html`
- Reference captures: `preview/web/mocks/frontmatter-ux/flashtype-reference-flow.png` and `preview/web/mocks/frontmatter-ux/flashtype-reference-full.png`
- Production implementation: `src/extensions/markdown/components/frontmatter-editor.tsx`, `src/extensions/markdown/editor/frontmatter-value.ts`, `src/extensions/markdown/editor/tiptap-markdown-bridge/nodes.ts`, and `src/extensions/markdown/style.css`
- Production captures: `preview/web/mocks/frontmatter-ux/production-flow-rest.png`, `preview/web/mocks/frontmatter-ux/production-flow-initial-add.png`, `preview/web/mocks/frontmatter-ux/production-flow-add-property.png`, `preview/web/mocks/frontmatter-ux/production-flow-full.png`, `preview/web/mocks/frontmatter-ux/production-flow-after-removal.png`, and `preview/web/mocks/frontmatter-ux/production-flow-mobile.png`
- Full-view comparison: `preview/web/mocks/frontmatter-ux/flashtype-production-comparison.png`
- Focused add-flow comparison: `preview/web/mocks/frontmatter-ux/flashtype-focused-comparison.png`
- Viewports: 1720 × 1100 source; 1280 × 900 production desktop; 390 × 844 production mobile.

## States and flows verified

- **2a / empty document:** no persistent frontmatter chrome is rendered.
- **2b / discovery:** the first markdown line retains the quiet `Add frontmatter` hover disclosure and the slash command remains available.
- **2b2 / adding:** invoking frontmatter opens a transient `Property name` row. Enter commits a unique key and moves focus to its value; Escape or an empty blur cancels the flow.
- **2c / populated:** frontmatter uses a compact two-column property sheet with type icons, low-chrome cell hover states, a quiet YAML action, and a distinct `+ Add property` action.
- Removing the final property deletes the entire frontmatter node and returns the document to 2b2 discovery. Undo restores the removal.
- Programmatic removal is available through `unsetFrontmatter()`.

## Fidelity review

- **Typography:** quiet metadata typography, compact labels, and the existing Atelier document hierarchy match the supplied direction.
- **Layout:** no framing card, upper rule, shadow, or permanent selected tab. Keys use a fixed compact track; values remain aligned; nested object rows retain the same visual rhythm.
- **Color:** neutral editor tokens handle hover, focus, empty values, tags, and actions. Accent color is reserved for real selection/focus behavior.
- **Icons:** Lucide type icons distinguish text, number, boolean, date, list, person, and object fields without decorative color.
- **Responsive behavior:** at 390 px, rows stack key above value, remain editable, and avoid horizontal clipping.
- **Copy:** the interface consistently says `Frontmatter`, `Property name`, `Empty`, `YAML`, and `Add property`.

## Comparison history

1. The prior flow created a default `title` field and could leave an empty frontmatter shell visible after every field was removed.
2. The add flow was changed to a transient property-name row so frontmatter is not committed until the user names a property.
3. Final-property removal now deletes the node and returns to the first-line hover/slash-command discovery state.
4. The full state was restyled against the supplied 2c design: type icons, cell-level hover, a hidden-at-rest YAML action, quiet tags, and an unambiguous add action.
5. Desktop, mobile, empty, adding, populated, and final-removal captures were compared. No P0/P1/P2 mismatch remains.

## Automated validation

- Full test suite: 62 files passed, 554 tests passed, 1 skipped.
- Typecheck: passed.
- Lint: passed with 11 pre-existing warnings and no errors.
- Preview build: passed with the existing bundle-size warning.
- Production browser console: no errors in the verified frontmatter flow.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the native date input presents its value using the browser locale while YAML serialization remains ISO-formatted.

## First-line disclosure alignment

- Reference: `/Users/samuel/Library/Application Support/CleanShot/media/media_AHTVCO3G8C/CleanShot 2026-07-11 at 16.03.48@2x.png`.
- The disclosure keeps its padded hover target while shifting that target one padding unit left of the Markdown content edge.
- Browser measurements at the production desktop viewport: first Markdown block left edge `393px`; frontmatter icon left edge `393px`; disclosure background left edge `385px`.
- This matches the selected design: the icon and first Markdown line share one vertical guide, while the hover background extends `8px` into the outer gutter.
- Focused editor tests: 21 passed.
- P0/P1/P2 alignment mismatches: none.
- P3: the Vite development session logged React's existing synchronous-unmount warning while hot-reloading and switching fixture files; the CSS-only alignment change does not add or alter component lifecycle behavior.

final result: passed
