# CSV keyboard and property editor QA

Baseline: latest main `5c3422e`. This harness uses the installed, patched Glide `DataEditor` with Atelier's production `providePropertyEditor`, including the same pointer-down activation setting for plain text-backed columns. It uses controlled in-memory rows to isolate keyboard behavior. It does not mount `CsvView`, exercise Lix persistence, or replace tests of CsvView's custom canvas checkbox toggle.

## Reproduce

From the repository root, after installing the patched dependencies:

```sh
pnpm exec vite --config artifacts/csv-qa/keyboard/harness/vite.config.mjs --host 127.0.0.1 --port 5198 --strictPort --force
```

In another terminal:

```sh
node artifacts/csv-qa/keyboard/browser.mjs
```

The runner requires Playwright 1.57.0 and its Chromium browser, available in this workspace. Set `CSV_QA_URL` to override the harness URL. Results and screenshot are overwritten beside this README.

## Confirmed defects and fixes

- Composing Enter/Escape in the select picker committed an option or cancelled the picker before the IME finished. The picker now leaves composition keys to the input.
- Glide's overlay treated composing Enter as a cell commit. Its patched finish handler ignores native composing events and key code 229.
- Glide scheduled a delayed finish callback for ordinary keys and Shift+Enter. An older callback could observe a later Enter movement but carry `save=false`, silently cancelling the edit. Real Chromium reproduced `first\nsecond` reverting to `Hello world` after rapid Shift+Enter, typing, then Enter. The patched overlay now schedules completion only for actual finish keys. Normal key events continue propagating; the Atelier text editor does not swallow them.

- Modified clicks could open an editor for the range anchor at the clicked cell's bounds. Glide now emits the public click callback but skips renderer editing and activation for non-touch Shift/Ctrl/Meta/Alt clicks. CsvView separately guards its checkbox callback so range selection does not toggle data. Glide also forwards the native Alt flag in all mouse-event variants through an optional `altKey` field; previously Alt was absent from these events, so native Alt-click bypassed guards.

The existing dependency patch includes matching source, ESM, and CommonJS changes. The lockfile hash was regenerated with `pnpm install --lockfile-only --ignore-scripts`. The full patch was reverse-applied and re-applied successfully to a copied installed package, including `git apply --check` in both directions.

## Fresh expanded round

`browser-results.json` records the clean 20-scenario expanded round and Chromium version. Scenarios cover text/number/email/URL edits, Enter movement, Escape cancellation, Tab/Shift+Tab movement, outside-click commit, rapid multiline editing, native multiline/tab clipboard paste into an active cell editor, select choice and option creation, checkbox property picker, date Save, IME handling, pointer-down activation, Shift-click range selection, and Ctrl/Meta/Alt clicks retaining the public callback without opening an editor. No page errors occurred.

Clipboard paste uses real Chromium clipboard permission and Ctrl+V. IME text uses CDP `Input.imeSetComposition` and `Input.insertText`; the composing Enter key is explicitly dispatched with `isComposing` and key code 229. This validates the production DOM event path but is not a claim of full operating-system IME candidate-window coverage. Grid-level TSV paste and persistence are separate CsvView tests; this runner covers the active text editor clipboard path.

Unit regressions in `csv-property-keyboard.test.tsx` cover IME picker keys, post-composition Enter, normal Escape, and arrow selection. The browser runner is the regression check for the patched real Glide overlay race.
