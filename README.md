# Atelier

**Atelier is a UI toolkit for [Lix](https://github.com/opral/lix).** It gives
you views over a lix, and a shell that arranges them.

A view shows lix data: a file, the history, a SQL console. You add your own
views through extensions. Each view can run in two modes:

- **Mounted** — React, interactive, placed in an area of the shell.
- **Static** — HTML, no React and no DOM. For a server, a chat card, an email.

A view does not have to support both. A canvas view has no static mode, and it
says so. The shell is one arrangement of views, not the definition of Atelier:
a host can replace any bundled view by id, or build its own shell from the
views.

### Rules for adding to this package

1. **The unit is a view, not a file type.** A capability that only works for
   Markdown belongs inside the Markdown view. It is not a new export.
2. **A view declares its modes.** Mounted and static are both optional.
3. **Bundled views are not special.** They use the same extension API a host
   uses. `ATELIER_BUILTIN_EXTENSION_IDS` lists the ids you can replace.

The host owns the Lix handle, the routing, the authentication, and the
product's chrome. Atelier owns none of those.

## Mounted

```tsx
import { Atelier } from "@opral/atelier";
import "@opral/atelier/style.css";

<Atelier lix={lix} location={{ path: "/README.md" }} />;
```

The host opens the Lix handle and closes it after unmount. Atelier owns its
UI, subscriptions, extension loading, and editor lifecycle.

## Static

```ts
import { toHtml } from "@opral/atelier/render";

const view = toHtml(
	{ path: "/README.md", before, after },
	{ maxBytes: 24_000 },
);
if ("html" in view) send(view.html);
else console.log(view.skipped); // why there is no view
```

Bytes in, HTML out. Markdown and CSV have static views today.

Which side is missing says what happened:

| input                | `kind`     |
| -------------------- | ---------- |
| `after` only         | `added`    |
| `before` and `after` | `modified` |
| `before` only        | `removed`  |

`kind`, and the `counts` of entities added, modified and removed, use the same
words as `lix_diff`. `hidden` is how many entities the size budget left out.

A file type with no static view returns `{ skipped: "unsupported" }`. Other
reasons are `unchanged`, `empty`, `too-large` and `failed`. `toHtml` does not
throw.

### Styling a static view

Put the HTML inside an element with class `atelier-render` and load
`@opral/atelier/render.css`. Or pass `document: true` to get a complete HTML
file with the styles inlined.

Colours are `--atelier-*` custom properties from `@opral/atelier/theme.css`, the same file the app uses; a host that redeclares one on any ancestor retints the render.

## Entries

| entry                           | what it is                       | guarantees                                                                          |
| ------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `@opral/atelier`                | the shell, and the extension API | React                                                                               |
| `@opral/atelier/render`         | views, without a shell           | no React, no DOM, closure under 700 kB — checked by `scripts/render-entry.test.mjs` |
| `@opral/atelier/render.css`     | styles for static views          | generated tokens, no colour literals in rules                                       |
| `@opral/atelier/style.css`      | styles for the shell             |                                                                                     |
| `@opral/atelier/file-icons`     | path → icon                      | no React, no DOM                                                                    |
| `@opral/atelier/state-adapters` | the shell's persistence ports    |                                                                                     |
| `@opral/atelier/dev-tools`      | tools for working on Atelier     | not for shipping                                                                    |

## Static rendering

Mount the interactive workspace directly with an open Lix handle. Each view loads the data it needs; workspace startup does not prepare a repository snapshot.

For server-rendered documents, use the separate static renderer:

```ts
import { toHtml } from "@opral/atelier/render";

const result = toHtml({ path: "/README.md", after: content });
```

The host supplies authorized file bytes. This renderer does not open a workspace or retain a Lix connection.

## Routing

A location identifies a repository path or an extension view:

```tsx
<Atelier
	lix={lix}
	location={{ path: "/notes.md", branchId }}
	navigation={{
		href: (location) => repositoryUrl(location),
		fileHref: (file) => rawFileUrl(file),
		navigate: (location) => router.navigate(repositoryUrl(location)),
	}}
/>
```

The optional `fileHref({ path, branchId, commitId })` returns a raw file URL. It enables repository-relative Markdown images and native image, PDF, and video rendering during SSR, including files too large to inline. After hydration PDFs progressively enhance to the existing PDF.js canvas, page controls, and accessible page text using the raw URL and bounded range requests; no browser Lix connection or full-blob database read is required. A download link remains available if rendering fails. Serve the requested revision with the correct media content type and support HTTP ranges for large media. File revisions keep native playback stable when unrelated files change.

Extension locations use `{ view: "dashboard", state: { filter: "open" } }`. Native links use `href`, so documents remain navigable before JavaScript starts. Optional `slots`, state stores, branch session, and events integrate host controls without exposing a separate workspace runtime.

## Diffs

A review opens a file with two refs: the checkpoint and the working file, or
the two ends of a checkpoint's span. Every view renders that diff itself.

Markdown, CSV and text diff in place — marked words, changed cells, a unified
diff. An image, a PDF, a video, a drawing or an HTML artifact cannot be diffed
in place, so those views draw both revisions side by side: the older one on the
left, the newer on the right. A file the write created has no left side; one it
deleted has no right side. Each side reads its own commit, assets included: an
artifact's images come from the commit the artifact belongs to, so a checkpoint
is never drawn with today's files.

A view reads the working review from `atelier.diff.session`, and a checkpoint's
span from `beforeCommitId` and `afterCommitId` in its own view state. The shell
hands both refs to every view and decides nothing by file type. A view that is
about to compare says so, and the prepared document waits: one revision painted
first would only be replaced a moment later.

## Extensions

Extensions load data and render in Atelier's React tree:

```tsx
const extensions = [
	{
		id: "summary",
		name: "Summary",
		async load({ lix, signal }) {
			signal.throwIfAborted();
			const result = await lix.execute(
				"SELECT count(*) AS count FROM lix_file",
			);
			return { count: Number(result.rows[0].count) };
		},
		Component({ data }) {
			return <p>{data.count} files</p>;
		},
	},
];

<Atelier lix={lix} extensions={extensions} location={{ view: "summary" }} />;
```

Loaders return plain JSON; components receive `{ data, atelier, view }`. Each view owns its loading and error state. `fileExtensions` associates an extension with file types. Reusing a built-in extension ID replaces that built-in view. Clean up browser editors and listeners in component effects.

Bundled Markdown, CSV, text, HTML, images, media, and drawings provide initial content. Markdown and CSV progressively initialize their interactive editors; drawings provide a basic SVG scene until Excalidraw is ready. Large media previews are deferred to avoid embedding unbounded binary data. Browser-installed repository extensions remain browser-only; the server does not execute arbitrary repository JavaScript.

See [embedding](docs/embedding.md) and [CSV properties](src/extensions/csv/README.md). The development preview is in `preview/web/`.

## License

[MIT](./LICENSE).

## Composable history

`Atelier.History` remains available to host extensions as `<Atelier.History atelier={atelier} />`.

### Reviewing already-applied changes

Use `intent: "review-applied"` when the changes are already in the local
repository, for example after an agent finishes a turn:

```ts
await atelier.diff.open({
	base: { commitId: beforeAgentTurn },
	target: { commitId: afterAgentTurn },
	intent: "review-applied",
});
```

Both refs must be commits. Atelier displays **Keep / Undo** for that exact span.
Keep records a private per-file decision without creating a checkpoint. Undo
reverses the selected files' changes, including additions, deletions, and renames.
If a selected file changed after the target commit, Undo fails without overwriting
those edits; unrelated files can continue changing. Decisions use the configured
review-status store, and resolved files are skipped when reopening the same span.
Partial decisions advance to the remaining files; resolving all files exits review.
Read-only hosts can inspect the span but cannot resolve it.

Without `intent`, the existing working-change and historical comparison behavior
is unchanged. The public diff session exposes `intent` so extensions can identify
an applied review. No callbacks or action configuration are required.

## Migration from prepared workspace startup

`loadAtelier`, `AtelierInitialState`, and the `initialState` and `instance` props have been removed. Pass the borrowed live handle directly: `<Atelier lix={lix} location={location} />`. The host opens the intended branch and closes its own handle. Use `@opral/atelier/render` for static documents.
