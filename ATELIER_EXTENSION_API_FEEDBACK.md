# Atelier extension API feedback

This log records extension-runtime friction found while integrating and QAing
Atelier PR #70.

## Read-only was split between host configuration and revision state

`atelier.readOnly` previously described only a host-level workspace
restriction. Historical document views were made read-only independently by
inspecting `beforeCommitId` and `afterCommitId` in each bundled extension.

That split contract produced inconsistent surfaces: Markdown replaced its
normal editor chrome with a separate snapshot renderer that omitted the
formatting toolbar, while other editors implemented their own combinations of
host read-only and revision checks.

Resolution: `atelier.readOnly` is now the effective read-only state for the
specific mounted view. The runtime sets it when either the host is read-only or
the view is pinned to a historical revision. Extensions can keep their normal
surface and disable mutation affordances from this single signal.

## QA: first checkpoint diff can use a stale current Markdown snapshot

Confirmed in the local preview on 2026-07-29.

Reproduction:

1. Open `new-file.md` in the live editor and verify the current document ends
   with `YEs very good!`.
2. Open History and select Latest checkpoint.
3. Observe a diff against older live-editor data: `Nice how are you?s` appears
   and the final `YEs very good!` paragraph is missing.
4. Select another checkpoint, then select Latest checkpoint again without
   editing the document.
5. Observe that the same checkpoint now renders the actual current document,
   including `YEs very good!`.

Expected: a checkpoint-to-current diff is deterministic, and its after-side is
the latest `lix_file` state every time it opens.

Likely cause: `MarkdownViewContent` reads `lix_file` with
`useQueryTakeFirst(..., { subscribe: false })`. The live TipTap editor can hold
newer subscribed state while that outer row remains the snapshot from its
original mount. Changing a live view into a historical diff reuses the mounted
view and consumes the stale outer row. Switching checkpoints closes the view;
the non-subscribed query is evicted after unmount, so reopening then reads the
fresh row and changes the result.

Suggested resolution: make the current/after side of a historical diff an
explicit fresh or subscribed file read. Do not derive it from a snapshot query
whose lifecycle began while the view was still a live editor.

Resolution: fixed in Atelier. `MarkdownViewContent` now subscribes to
`lix_file` when a historical revision compares `beforeCommitId` to the current
workspace state. The query cache therefore uses a fresh subscribed entry when a
mounted live view enters checkpoint diff mode. Snapshot-only and
checkpoint-to-checkpoint reads remain one-shot. A lifecycle regression covers
live mount → file mutation → historical diff using the same mounted view.

This was not a Lix bug. Lix returned the requested data correctly; Atelier was
retaining a deliberately non-subscribed query result beyond the lifecycle in
which it was safe to use as HEAD.

## QA: empty Markdown paragraphs render as full diff hunks

Confirmed in the same checkpoint sequence. The rendered diff contained:

```text
<p data-review-status="removed"></p>
```

This produces the large empty red or green rows visible between text changes.
Empty structural paragraphs should either be omitted from the review document
or rendered as a compact newline marker instead of a full-height block.

## QA: React state update warning during checkpoint navigation

The preview console emitted this error during the reproduction:

```text
Cannot update a component (`LayoutShellStateLoader`) while rendering a
different component (`LayoutShellLoadedContent`).
```

The exact triggering transition still needs isolation, but checkpoint QA should
remain console-clean before this workflow is considered complete.

## QA: checkpoint comparison semantics were pointed at HEAD

The initial History integration modeled a selected Markdown checkpoint as
`selected checkpoint → current workspace`. That makes every historical row
change as HEAD changes and does not explain what the checkpoint itself
introduced.

Resolution: History now passes both the selected checkpoint and its immediate
predecessor to the shell. Markdown opens the pair as `beforeCommitId` and
`afterCommitId`, so each row shows `previous checkpoint → selected checkpoint`.
Working changes remains the only `latest checkpoint → current workspace`
comparison.

The last three local checkpoints were verified as an incremental sequence:

1. `Hello world` added.
2. `How are you?` added.
3. `Good and you?` added.

## QA: active review focus leaked into read-only checkpoint diffs

The orange border was the active-change `box-shadow` used to anchor interactive
per-change review controls. Historical diffs disable those controls, but the
review editor still assigned `data-review-active="true"` to the first change.

Resolution: read-only review editors no longer assign an active change. The
green/red diff styling remains, while the interactive orange focus ring is
limited to reviews where individual changes can actually be acted on.
