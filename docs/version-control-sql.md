# Version-control SQL used by Atelier

Atelier requires Lix's consolidated version-control SQL contract. These are coordinated breaking changes; an older SDK/engine cannot execute the new queries.

- `lix_log()` lists retained commits on the active first-parent chain. History filters `is_checkpoint` and uses `parent_commit_id` for the comparison. Repository-global checkpoint metadata comes from `lix_commit WHERE is_checkpoint`.
- `lix_history('lix_file')` returns endpoint differences introduced by each retained mainline commit. File History filters `lixcol_commit_is_checkpoint`, consumes `diff_type` directly, and uses the before/after paths. It no longer infers changes from neighboring revisions or timestamp-ordered checkpoint markers.
- `lix_diff('lix_file')` compares the actual working baseline with the head. `lix_branch.working_base_commit_id` and `commit_id` are captured with the diff in one read batch, including when the diff is empty. Selected checkpoint/revert and inline-review guards use the diff's actual endpoint columns.
- `lix_as_of('lix_file', commit_id)` reads complete file state at one retained commit. Historical contents, metadata, paths, media, and Markdown assets remain lazy and pinned to their selected commit.

A checkpoint comparison means its actual parent → the checkpoint. On a dirty fork, that parent can be an unmarked automatic commit. Inherited content remains in the checkpoint's complete state but is not attributed to the checkpoint's own changes. Selecting checkpoint rows never changes the comparison baseline.

Whole-repository restore still restores complete state. Selected-file restore still applies a current-head → target-state diff; a checkpoint's history rows alone do not describe everything that must be restored.

Checkpoint file previews load in pages of at most 20 checkpoints. Observing any row near the viewport enables one shared `lix_history` query anchored at that page's newest commit, with all page destinations in `lixcol_to_commit_id IN (...)`. More visible rows on the same page reuse the result. The initial loader warms only the first page. Lix must stop after the selected destinations, prune unselected comparisons, and avoid loading file bytes when only names are projected.

LixRay embeds `AtelierFile` for inline README reviews and published files. It uses the same declarative extension renderer as the workspace, accepts explicit historical endpoints or a captured working epoch, and keeps images and content pinned to that range. The host integration uses the current `Atelier` component and declarative `Component` extension registrations.
