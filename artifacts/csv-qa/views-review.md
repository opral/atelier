# CSV views, review, and independent parser QA

Baseline: latest main `5c3422e` in `/root/repos/atelier-csv-qa-loop`.

## Findings fixed

- Numeric sorting mixed numeric and lexical comparisons. The cycle `-10 < -2 < -3x` but `-10 > -3x` made row ordering depend on input order. A shared comparator now groups valid numeric values consistently and is used by live and review grids. Whitespace-only values are not treated as zero.
- Review fallback matching ignored conflicting stable column IDs. A deleted/recreated column with the same name appeared unchanged; a changed name appeared renamed. Name/data matching now respects identity when both sides supply IDs.

## Executed rounds

1. Regression reproduction: three failing assertions (two identity variants and numeric transitivity), then fixes. Existing filter/view/review suites plus regressions: 39 passed.
2. Fresh model matrix: three column orders × three row add/remove/reorder patterns, every before/after index and cell value checked; nine numeric input rotations in both directions; saved multi-choice filtering after column removal. Clean, seven total QA tests passed.
3. Fresh actual CsvTable callbacks with real Lix persistence and mocked Glide rendering: sorted/filtered paste including append overflow, cell clear, single selected-row deletion, and insert/delete column metadata identity preservation. Four passed. Hidden rows and other metadata namespaces remained unchanged.
4. Independent parser/document review after root changes: 15 tests passed. Covered comma/semicolon/tab, CRLF/LF/CR/mixed endings, BOM, multiline quoted fields, escaped quotes, tolerant malformed quotes, ragged and empty records, new empty final rows, untouched record bytes, and generated header collision avoidance. No additional defects found.

## Commands

```sh
node_modules/.bin/vitest run src/extensions/csv/csv-view-review-qa.test.ts src/extensions/csv/csv-review-model.test.ts src/extensions/csv/csv-review-grid.test.tsx src/extensions/csv/csv-views.test.ts src/extensions/csv/csv-filter.test.ts
node_modules/.bin/vitest run src/extensions/csv/csv-view-review-qa.test.ts
node_modules/.bin/vitest run src/extensions/csv/index.reactive.test.tsx -t 'fresh mapping'
node_modules/.bin/vitest run src/extensions/csv/csv-parser-independent-qa.test.ts
```

Scope limits: callback tests exercise CsvTable and persistence but mock Glide's canvas renderer; actual browser typing is covered by another QA agent. CSV has no stable row IDs, so review's documented conservative matching policy remains. No claim of exhaustive coverage beyond these bounded matrices.

## Final independent integration review

After the persistence owner confirmed the hook and tests were stable, independently reviewed queued edit intent, failure merging, stale reconciliation guards, read-only/review pausing, and draining authorized writes after unmount. The live editor remounts by file ID, isolating queues across files. Certified review data uses its own `parsedOverride`, not mutable hook text. No additional reachable regression was identified.

Final command:

```sh
node_modules/.bin/vitest run src/extensions/csv/use-synced-csv-file.test.tsx src/extensions/csv/csv-parser-independent-qa.test.ts src/extensions/csv/csv-view-review-qa.test.ts src/extensions/csv/index.reactive.test.tsx
```

Result: **79 passed across four files** after all final persistence changes. This independent review and the fresh callback/parser matrices are clean within the documented scope.

## Final modifier-selection follow-up

A subsequent browser round found that modified cell clicks could open an editor or mutate checkbox values. Independently reviewed the final Glide guard placement: public `onCellClicked` still fires, but mouse Shift/Ctrl/Meta/Alt clicks return before renderer mutation or editor activation. Mouse-down selection handling remains intact; touch and ordinary clicks keep their existing path. Equivalent changes are present in source, ESM, and CommonJS patch sections.

CsvTable's custom checkbox callback now separately ignores modified mouse clicks. Seven integration tests pass: all four modifiers preserve selection without writing; ordinary and touch filtered/sorted callbacks toggle the displayed row using its existing numeric encoding; a fresh six-value matrix verifies yes/no, true/false, and 1/0 with ordinary/touch callbacks. The suspected sorted checkbox source mismatch was disproved: `parsed.rows` already contains visible mapped rows.

Commands after the modifier patch:

```sh
node_modules/.bin/vitest run src/extensions/csv/index.reactive.test.tsx src/extensions/csv/csv-view-review-qa.test.ts src/extensions/csv/csv-parser-independent-qa.test.ts
# 66 passed before adding the final encoding-matrix test.
node_modules/.bin/vitest run src/extensions/csv/index.reactive.test.tsx -t 'checkbox callback|sorted checkbox|fresh checkbox'
# 7 passed, including the new encoding matrix.
```

Independent modifier/control-flow review and the fresh encoding matrix are clean. The browser owner separately verified the real Glide behavior and patch application.

### Alt event forwarding correction

Final typechecking exposed that upstream Glide omitted `altKey` from both its mouse-event declaration and runtime forwarding. The integration mock had manually declared the property, masking this gap. The patch now attaches `altKey: ev?.altKey ?? false` at the shared mouse-argument return point (source/ESM/CommonJS), covering every event variant, and adds the optional property to source/public declaration types. Independently reviewed all copies. The mock now derives modifier properties from actual `CellClickedEventArgs` instead of declaring them independently.

After installation, `node_modules/.bin/tsc -p . --pretty false` passed and all seven checkbox integration regressions passed. Real browser modifier coverage is owned by the typing agent. No further issue found in this independent review.
