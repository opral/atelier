# CSV properties

The `atelier_csv` extension edits ordinary CSV content and optionally stores property definitions in the same Lix file's `lixcol_metadata.atelier_csv` namespace. There is no descriptor sidecar and no new table file format. This is the sole built-in `atelier_csv` handler used by both `Atelier.Shell` and `Atelier.FileView`; it needs no preview flag or host registration. Column clicks and double-clicks use the same property menu, including its inline name field.

```json
{
	"atelier_csv": {
		"version": 1,
		"columns": [
			{
				"id": "stable-column-id",
				"header": "stage",
				"index": 0,
				"type": "select",
				"options": [
					{ "value": "discovery", "color": "gray" },
					{ "value": "qualified", "color": "blue" }
				]
			}
		]
	}
}
```

Supported property types are `text`, `select`, `checkbox`, `date`, `number`, `email`, and `url`. Types control presentation and editing; changing a type never coerces existing values. Select values remain ordinary CSV strings. Options can exist without any row using them. Unknown option colors render gray, and unlisted select values remain visible with a subtle underline.

Text columns offer **Wrap content / Unwrap content** in the column menu. Wrapping respects explicit line breaks and expands each row to fit its longest wrapped cell; resizing, filtering, sorting, and editing recompute row heights. Search highlighting follows text across wrapped lines. Default-view wrapping is optional `columns[].wrap` metadata; a named view snapshots its own wrapping in `widths[].wrap` and uses **Save changes** for updates. CSV bytes remain untouched by wrap changes.

Select options can be renamed, deleted, and reordered through Edit property. Renaming updates all exact matching cells in the column and the option descriptor together, preserving the color and active filter choices. Blank or duplicate names (including names already used by unlisted CSV values) are rejected. Deleting a used option requires confirmation showing the affected row count and clears those cells; unused options are deleted directly. Drag options to reorder or use Move up/Move down; order is metadata-only and is shared by cell, filter, and bulk pickers.

Missing, malformed, or newer metadata versions render as text columns. Opening a file does not write metadata. Content-only edits preserve unsupported metadata. Explicitly configuring a property creates version 1 definitions for the current columns, including virtual columns in ragged CSVs.

Column IDs survive edits made through the extension. Exact unique raw headers can follow external column reordering; duplicate or empty headers resolve only when their complete position set still matches. Ambiguous external changes fall back to text. CSV itself cannot encode column identity, so indistinguishable duplicate-header reorders cannot be detected.

The write queue owns both bytes and column metadata. Metadata updates merge against the latest file metadata and use a revision-guarded atomic update, preserving other namespaces. Creating and selecting an option, or changing column structure, writes bytes and definitions together. Metadata-only edits do not rewrite CSV content. Failed writes are shown and retried. Historical views read properties from the same commit as their content.

Search, filter rules, sort, column widths, and text wrapping can be saved as named views in `atelier_csv.views` on the same file. The Views menu supports saving the current setup, switching, renaming, and deleting views. Changes to a selected view stay local until **Save changes**; **Reset changes** restores its saved settings. **Default view** clears filters, sorting, and search and restores automatic widths. Reopening a file starts on Default view; saved views remain available in the menu. Saved settings reference stable column IDs, survive column renames and insertions, and ignore references to deleted or unrecognized columns. Option renames/deletions update saved filter values atomically with the CSV and option definitions. Layout includes column widths and per-column text wrapping. Multiple rules can be combined with Match All (AND) or Match Any (OR), using the same typed controls per rule. Incomplete rules are ignored in both modes; no active rules shows all rows. Rules can be added, removed, or cleared as a group. Filters and sorts map edits back to original records and never reorder the saved CSV; structural column changes clear positional filters and sorts. Select filters reuse the colored option pills and searchable menu, including values found in the CSV that have no option metadata. Select filters allow multiple options, match any checked value exactly, and show all rows when cleared. The picker stays open while selecting and keeps its search query. Checkbox filters also allow multiple choices. Date filters match exact values; checkbox filters normalize yes/no, true/false, and 1/0 while keeping empty distinct. Number filters compare numeric values; text columns retain case-insensitive contains matching. Switching filter columns clears the previous value; reselecting the same column and renaming a column preserve it. Keyboard Tab/ShiftTab leaves the picker for adjacent filter controls.

The CSV plugin needs no changes: it can continue projecting CSV content for Lix history/querying. Property rendering and configuration belong to Atelier. Exporting just the CSV bytes exports values; the optional property metadata remains attached to the file in Lix.

Row numbers reveal checkboxes on hover; selecting a row reveals the remaining checkboxes. Click to toggle individual rows, Shift-click for a range, or use the header checkbox to select all visible rows. The selection bar supports bulk property edits, deletion, and clearing selection (also Escape). Delete/Backspace deletes selected rows. Select, checkbox, and date properties use their corresponding bulk editors; plain CSV columns use text inputs. Bulk checkbox edits preserve each cell's existing yes/no, true/false, or 1/0 encoding. Search/filter/sort changes that alter the visible row mapping clear the selection. Selection itself is temporary and never writes metadata.

The workspace patches Glide 6.0.3 to import the cell overlay eagerly. Its upstream `React.lazy` otherwise starts a separate network request on the first edit. The patch also prevents a queued canvas-focus callback from stealing focus after an editor opens. Keep both changes together when upgrading Glide. Because Atelier externalizes Glide in its library build, consuming workspaces must carry this patch too until the behavior is fixed upstream.

The Glide patch additionally provides opt-in `pointer-down` activation for plain text-backed editors (text, number, email, and URL). Selection and editor mounting happen together on an unmodified primary mouse press; releasing the button does not reopen the editor. Modifier-assisted range selection, row selectors, context menus, and touch scrolling retain their existing behavior. Select/date pickers and checkbox cells keep click activation.
