# Lix API feedback from Atelier

This log records API friction found while updating Atelier PR #70 to the SQL
diff commands merged in `opral/lix#920`. The integration is pinned to Lix
`origin/main` at `d0c2c4d5e58c85869e649ff2a5235f3d3576ef18`.

## SQL diff commands

### Empty selections require a preflight query

The command sinks reject an `INSERT … SELECT` whose selection is empty with
`diff command selection is empty`. In a file-scoped UI, an empty selection is a
normal idempotent outcome: a selected file can be unchanged in the requested
range, or reactive state can refresh between rendering and clicking.

Atelier currently runs a matching `SELECT count(*)` before every
`lix_apply`, `lix_revert`, and `lix_create_checkpoint` command. This adds a
round trip and leaves a race between the preflight and the command.

Suggestion: treat an empty command selection as a successful zero-row
operation, consistent with ordinary SQL DML.

### File-scoped commands need repeated ownership SQL

The diff surfaces expose `file_id`, but file descriptor changes identify their
file through `entity_pk`. Every file-scoped command therefore repeats:

```sql
coalesce(
  file_id,
  case
    when schema_key = 'lix_file_descriptor'
    then lix_json_get_text(entity_pk, 0)
  end
)
```

Suggestion: expose a normalized logical `file_id` for file descriptor diffs, or
provide a composed file-diff surface that includes `diff_id`.

### Command sinks only accept `INSERT … SELECT`

Rejecting `VALUES` means an application cannot query and inspect a set of
`diff_id`s, make an application-level selection, then submit that exact set as
parameters. The selection must be reconstructed inside the command SQL.

This is workable for Atelier's current filters, but it couples UI selection
logic to SQL text and makes more complex client-side selection harder.

Suggestion: consider allowing parameterized `VALUES` while retaining stale
`diff_id` validation in the engine.

## Build integration

### Updating the submodule requires a workspace reinstall before `build:lix`

After moving the submodule from `beb2f1ca` to `d0c2c4d5`, the first
`pnpm run build:lix` completed both native and WASM Rust builds, then failed in
the SDK TypeScript build:

```text
src/remote/client.ts(1260,36): error TS2307:
Cannot find module 'fflate' or its corresponding type declarations.
```

The updated SDK manifest declares `fflate`, but Atelier's existing
`node_modules` was installed for the previous submodule commit. A root
`pnpm install` is therefore required after advancing the pinned Lix checkout.

Suggestion: make `scripts/build-lix.mjs` detect a missing/outdated workspace
install before starting the expensive native and WASM builds, or document the
required reinstall next to the submodule update workflow.

## Latest-main compatibility breaks

### `lix_file_history` changed from a table to a table-valued function

Queries written as `FROM lix_file_history` now fail during planning with:

```text
table 'datafusion.public.lix_file_history' not found
```

The new form is `lix_file_history()` for active-head history or
`lix_file_history($commit_id)` for an as-of snapshot. Atelier had to migrate
every history consumer and add a Kysely adapter for the table-valued function.
Queries that previously batched multiple `lixcol_as_of_commit_id` values now
need one table-function invocation per commit and a `UNION ALL` or multiple
round trips.

Suggestion: call out this breaking change in migration notes. A first-class
typed SDK/Kysely helper would also keep consumers from using `sql<any>` for a
public surface.

### Directory path storage no longer accepts Atelier's canonical form

Writing `/docs/` to `lix_directory.path` now fails with:

```text
non-root path must not end with '/'
```

Atelier historically uses a trailing slash to distinguish directory paths from
file paths throughout the tree UI. The integration now strips the slash at the
database boundary and restores it in the filesystem query.

Suggestion: document the directory path invariant prominently. If the strict
form is intentional, exposing a canonical path conversion helper would reduce
duplicated boundary normalization in clients.

### File descriptor IDs now require canonical UUID strings

After advancing from `d0c2c4d5` to `d8d5423c1`, inserts into `lix_file` with
human-readable fixture IDs fail while deriving `lix_file_descriptor.entity_pk`:

```text
value at primary-key pointer '/id' must be a valid canonical UUID string
```

The stricter invariant is reasonable, but it surfaced through the derived file
descriptor schema rather than at the `lix_file.id` boundary. Atelier updated
its newly rebased tests to use canonical deterministic UUIDs.

Suggestion: validate `lix_file.id` directly and mention the UUID requirement in
the file API migration notes so consumers get an error at the value they wrote.

### Fresh release requires release-age exceptions for every platform package

Atelier's seven-day `minimumReleaseAge` policy initially rejected the newly
published `@lix-js/sdk@0.9.0`. Allowing the SDK alone is not sufficient because
its four platform-specific optional packages are versioned and published
separately, so all five packages need explicit exceptions.

This is expected pnpm behavior rather than a Lix bug, but a release checklist
snippet listing the SDK and platform package names would make immediate upgrades
less error-prone for consumers with dependency-age policies.

### Published 0.9 schema uses `diff_type`, not `change_kind`

Switching from the source pin to `@lix-js/sdk@0.9.0` made every query selecting
`lix_working_diff.change_kind` fail with `LIX_COLUMN_NOT_FOUND`. The published
table exposes `diff_type` with the same `added | modified | removed` values.
Atelier now uses `diff_type` throughout its own query rows and consumers.

The runtime error clearly listed the available columns, which made diagnosis
straightforward. The friction is that TypeScript still accepted the stale
column reference, so this incompatibility appeared only at runtime. Generated
query types or a 0.9 migration note explicitly calling out the rename would
catch or explain this much earlier.
