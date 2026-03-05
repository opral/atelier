# Lix Catalog MVP Plan

## Objective

Introduce two canonical metadata surfaces for agents:

1. `lix_catalog_tables`
2. `lix_catalog_columns`

MVP goal: let agents discover the current public Lix surfaces and their columns from SQL.

## Why

The engine already knows table and column shapes, but that knowledge is split across registries, constants, and rewrite code. Agents need one stable SQL source of truth for:

1. Which public surfaces exist.
2. Which columns each surface exposes.

## Scope

In scope:

1. Engine-level read-only metadata surfaces for tables and columns.
2. Population logic based on current engine metadata sources.
3. Coverage for public core surfaces and dynamic entity views backed by builtin schemas and `lix_stored_schema`.

Out of scope (MVP):

1. `lix_catalog_functions`
2. Unknown table/column error integration
3. `information_schema` compatibility
4. Rich type/capability metadata that is not already cheap to derive from current engine logic

## Surface Definitions

## `lix_catalog_tables`

One row per public queryable surface.

Required columns:

1. `table_name` (TEXT, PK)
2. `schema_key` (TEXT, nullable; populated for entity views)

## `lix_catalog_columns`

One row per column per public queryable surface.

Required columns:

1. `table_name` (TEXT)
2. `column_name` (TEXT)
3. `ordinal_position` (INTEGER)

Primary key:

1. (`table_name`, `column_name`)

## Population Strategy

Populate catalogs from the current engine logic, without introducing a new metadata system first.

### Tables

1. Start from the public core surface names already registered in `PUBLIC_LIX_TABLE_REGISTRY`.
2. Enumerate entity views from builtin schemas plus the latest stored schemas visible through `lix_stored_schema`.
3. Emit concrete public `table_name` rows exactly as the engine exposes them, for example `lix_state`, `lix_state_by_version`, and `lix_file_history`.
4. For entity views, emit only the concrete table names the engine currently resolves, such as base, `_by_version`, and `_history` names.
5. Do not invent `_history_by_version` entity-view table names unless the engine actually resolves them.

### Columns

1. Use the in-code `lix_table_registry` / `PUBLIC_LIX_TABLE_REGISTRY` where a core surface already has explicit columns there.
2. Use the current state-column constants for `lix_state` and `lix_state_by_version`.
3. Use the current rewrite projection definitions for `lix_version` and `lix_active_version`.
4. Use entity-view target resolution plus projected columns for entity views.
5. Keep rows keyed by the concrete public `table_name`, so `lix_file`, `lix_file_by_version`, and `lix_file_history` each get their own rows.

Do not infer canonical metadata from `sqlite_master` or `pragma_table_info` at runtime.

## Implementation Notes

1. Reuse the current engine source of truth per surface family, even if that means the catalog is assembled from multiple code paths in MVP.
2. For stored schemas, use the latest schema definition per `schema_key`; MVP does not need historical schema catalog entries.
3. The catalog only needs to describe public queryable surfaces. Internal tables and internal vtables stay out of scope for MVP.

## Implementation Phases

1. Phase 1: Add stable schemas for `lix_catalog_tables` and `lix_catalog_columns`.
2. Phase 2: Populate public core surfaces from existing registries, constants, and rewrite projections.
3. Phase 3: Populate entity-view rows and columns from builtin schemas plus latest `lix_stored_schema` rows.
4. Phase 4: Add regression tests that keep catalog output aligned with current public surface logic.

## Acceptance Criteria

1. `SELECT table_name FROM lix_catalog_tables ORDER BY table_name` lists the current public core surfaces.
2. `SELECT column_name FROM lix_catalog_columns WHERE table_name = 'lix_file' ORDER BY ordinal_position` returns the current `lix_file` columns.
3. `SELECT column_name FROM lix_catalog_columns WHERE table_name = 'lix_state' ORDER BY ordinal_position` returns the current `lix_state` visible columns.
4. Builtin and stored-schema-backed entity views appear in `lix_catalog_tables`.
5. `lix_catalog_columns` returns projected columns for stored-schema-backed entity views.
6. No function catalog is required for MVP.

## Testing Plan

1. Unit tests for table rows generated from `PUBLIC_LIX_TABLE_REGISTRY`.
2. Unit tests for `lix_state`, `lix_state_by_version`, `lix_version`, and `lix_active_version` column generation.
3. Unit tests for entity-view table and column generation from builtin and stored schemas.
4. Regression tests to keep catalog output in sync with current public surface logic.

## Progress Log

- 2026-03-05: MVP narrowed to `lix_catalog_tables` and `lix_catalog_columns` only.
- 2026-03-05: Removed `lix_catalog_functions` and error discoverability from MVP scope.
- 2026-03-05: Anchored entity-view discovery to builtin schemas plus latest `lix_stored_schema` rows.
