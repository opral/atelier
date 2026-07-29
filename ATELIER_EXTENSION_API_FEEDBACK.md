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

