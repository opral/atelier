# Version-control SQL used by Atelier

Atelier requires Lix's consolidated version-control SQL contract. These are coordinated breaking changes; an older SDK/engine cannot execute the new queries.

- `lix_log([anchor])` lists retained commits on the first-parent chain ending at the anchor. Its `is_checkpoint` column is active at that anchor: filter it for the eligible checkpoint timeline, ordered by `position`. The latest eligible checkpoint at the active branch's `working_base_commit_id` uses `SELECT commit_id FROM lix_undo($1[, ARRAY row_refs])`; older checkpoints keep `SELECT commit_id FROM lix_restore($1[, ARRAY row_refs])`. `lix_commit` contains commit identity and creation time, not checkpoint metadata.
- `lix_history('lix_file'[, anchor])` returns endpoint differences introduced by each retained mainline commit. File History joins `lix_log(anchor)` to the history result on `commit_id = lixcol_to_commit_id`, filtering `log.is_checkpoint`; history has no checkpoint marker column. It consumes `diff_type` directly and uses the before/after paths. The join keeps the history comparison anchored to the same first-parent chain and does not change each checkpoint's actual parent baseline.
- `lix_diff('lix_file')` compares the actual working baseline with the head. `lix_branch.working_base_commit_id` and `commit_id` are captured with the diff in one read batch, including when the diff is empty. Selected checkpoint/revert and inline-review guards use the diff's actual endpoint columns.
- `lix_as_of('lix_file', commit_id)` reads complete file state at one retained commit. Historical contents, metadata, paths, media, and Markdown assets remain lazy and pinned to their selected commit.

Undo and redo functions are mutating SQL table functions even though callers use
`SELECT` to receive a nullable `commit_id` receipt. `lix_undo` accepts an
ordinary forward commit or the effective latest checkpoint and optional exact
`lix_row_ref` values; `lix_redo` accepts the returned undo receipt and the same
optional row scope. An empty selected scope is a no-op. Atelier keeps stale
review epoch guards around working and applied reviews before issuing these
functions.

A checkpoint comparison means its actual parent → the checkpoint. On a dirty fork, that parent can be an unmarked automatic commit. Inherited content remains in the checkpoint's complete state but is not attributed to the checkpoint's own changes. Selecting checkpoint rows never changes the comparison baseline.

Whole-repository restore still restores complete state. Selected-file restore still applies a current-head → target-state diff; a checkpoint's history rows alone do not describe everything that must be restored.

Checkpoint file previews load in pages of at most 10 checkpoints. Observing any row near the viewport enables one shared `lix_history('lix_file', anchor)` query anchored at that page's newest commit, with the explicitly selected page destinations in `lixcol_to_commit_id IN (...)`. The page IDs already came from the anchored checkpoint log, so the preview does not re-evaluate checkpoint status. More visible rows on the same page reuse the result. Empty checkpoints remain in the checkpoint list even when the history query has no file rows. The initial loader warms only the first page. Lix must stop after the selected destinations, prune unselected comparisons, and avoid loading file bytes when only names are projected.

LixRay embeds `AtelierFile` for inline README reviews and published files. It uses the same declarative extension renderer as the workspace, accepts explicit historical endpoints or a captured working epoch, and keeps images and content pinned to that range. The host integration uses the current `Atelier` component and declarative `Component` extension registrations.
