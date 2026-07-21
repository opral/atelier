# CSV editor fixtures

Seeded test files for **Atelier's CSV editor**. Each fixture exercises a
different part of the editing and line-preserving serialization behavior:

- `contacts.csv` — the happy-path table: links, emails, quoted cells with
  commas and escaped quotes. Good for trying cell edits, row/column menus,
  rename, paste, and the fill handle.
- `sales.csv` — 50 data rows for scrolling, multi-row selection, and bulk
  delete.
- `quoting.csv` — quoted commas, escaped quotes, and a multi-line cell.
  Editing one row must leave the other rows byte-identical (check the diff
  after an edit).
- `semicolon-crlf.csv` — semicolon-delimited with CRLF line endings. Edits
  must keep `;` and `\r\n`; new cells containing `;` get quoted.
- `ragged.csv` — rows shorter and longer than the header. Short rows pad
  virtually in the grid but keep their original bytes until edited.
- `empty.csv` — renders the empty state with the "Create table" action.
