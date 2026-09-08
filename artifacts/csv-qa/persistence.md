# CSV persistence QA

Baseline: latest main `5c3422e`. Tests use the actual React hook, `LixProvider`, and a real Lix database. Selected SDK calls are delayed or rejected to reproduce response ordering and retry failures deterministically; database reads assert saved content and metadata.

## Confirmed failures and fixes

1. Queued typing stalled after a read-only view became editable again. The queue now resumes when the temporary lock clears.
2. Two rapid metadata-only edits could overwrite newer external CSV bytes: the first save discovered external content, and the second interpreted its stale text as a content edit. Each queued operation now records content-write intent when the user edits, and failed writes merge that intent with newer queued work.
3. A delayed post-save reconciliation response replaced a newer externally observed value. Reconciliation now verifies both edit and observation generations.
4. A delayed reload after leaving review replaced a newer completed local edit. The reload now checks generations and is canceled when its effect becomes obsolete.
5. Entering review discarded edits queued behind an in-flight write. Existing edits now stay queued while review blocks new writes and resume afterward.
6. Unmounting while review/read-only blocked the queue left prior edits stranded. Closing the view now drains already accepted edits to that file; a new file's hook and queue remain isolated.

Each failure was reproduced before its fix with assertions on actual stored bytes or displayed hook state.

## Fresh post-fix round

The final fresh matrix found no new defects:

- A no-op content callback queued after a metadata update preserves external CSV bytes discovered during that update.
- Repeated unchanged-content callbacks create no file UPDATE operations.
- An old file's delayed queue drains after unmount without changing a newly mounted file's content or state.

The complete persistence suite passes **19 tests**, including automatic retry; content-plus-metadata success/failure ordering; rapid edits; unrelated/unsupported metadata preservation; concurrent revision retries; read-only external updates; queued review/unmount transitions; and stale-read ordering. Typecheck and targeted lint pass.

## Scope

CSV uses last-local-edit-wins for queued content edits, as documented in its editor implementation; this pass preserves that policy rather than inventing cell-level concurrent merging. File changes remount `EditableCsvView` through its existing `key={fileRow.id}`. These are database-backed hook tests, not browser grid or full-shell visual tests. The actual CSV caller passes `reviewText: null`; an unused non-null hook display path was excluded from application behavior claims.
