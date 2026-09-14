# Atelier

**Atelier is a UI toolkit for [Lix](https://github.com/opral/lix): views over a lix, and a shell that arranges them.**

A view shows lix data — a file, the history, a SQL console. Extensions are how
you add your own. Views mount in an area of the shell, or render on their own
as HTML for a surface that has no shell in it: a card in a chat, a mail, a page
rendered on a server.

The split is the one an operating system makes between a toolkit and a shell:
Atelier ships both, and the shell is *one* arrangement, not the definition. A
host can replace any bundled view by id, or build its own shell from the views.

Three rules, for anyone adding to this package:

- **The unit is a view, never a file type.** A capability that only works for
  Markdown is a bug in the capability, not a new export.
- **A view declares which modes it has.** Mounted (React, interactive) and
  static (HTML, no DOM) are both optional; a canvas has no static mode, and
  saying so is part of its contract.
- **Bundled views are not privileged.** They use the same extension API a host
  uses (see `ATELIER_BUILTIN_EXTENSION_IDS` for replacing one).

Atelier does not own the Lix handle, the routing, or the product's chrome.

## Mounted

```tsx
import { Atelier } from "@opral/atelier";
import "@opral/atelier/style.css";

<Atelier lix={lix} location={{ path: "/README.md" }} />;
```

The host owns the Lix handle and closes it after unmount. Atelier owns its UI, subscriptions, extension loading, and editor lifecycle.

## Static

```ts
import { toHtml } from "@opral/atelier/render";

const view = toHtml({ path: "/README.md", before, after }, { maxBytes: 24_000 });
if ("html" in view) send(view.html); // else view.skipped says why not
```

Bytes in, HTML out, for Markdown and CSV today. Which side is missing says what
happened: no `before` is a file that was created, no `after` one that was
deleted. The result carries `kind` and `counts` in `lix_diff`'s own vocabulary
(`added` / `modified` / `removed`, counted in entities), plus `hidden` for what
a budget left out. A file type with no static view answers `skipped`, never an
exception.

Pair the HTML with `@opral/atelier/render.css` inside an element with class
`atelier-render`, or pass `document: true` for a complete file with the styles
inlined. The palette is `--atelier-*` custom properties generated from the
app's theme: define your own on any ancestor and the render follows, with no
theming API.

## Entries

| entry | what it is | guarantees |
| --- | --- | --- |
| `@opral/atelier` | the shell, and the extension API | React |
| `@opral/atelier/render` | views, rendered without a shell | no React, no DOM, closure under 700 kB — enforced by `scripts/render-entry.test.mjs` |
| `@opral/atelier/render.css` | the static views' stylesheet | generated tokens, no literals in rules |
| `@opral/atelier/style.css` | the shell's stylesheet | |
| `@opral/atelier/file-icons` | path → icon | |
| `@opral/atelier/state-adapters` | the shell's persistence ports | |
| `@opral/atelier/dev-tools` | tools for working on Atelier | not for shipping |

## Server rendering

Load the initial view on the server, then pass the serializable result to the same component on the server and browser:

```tsx
import { Atelier, loadAtelier } from "@opral/atelier";

// Server loader. Open a session with the viewer's permitted access first.
const lix = await openRepositoryLix();
let initialState;
try {
	initialState = await loadAtelier({
		lix,
		location: { path: "/README.md" },
		readOnly: true,
	});
} finally {
	await lix.close();
}

// Render on both server and browser. The browser handle may arrive later.
<Atelier initialState={initialState} lix={browserLix} />;
```

`initialState` contains the shell layout, prepared query results, and extension data. It contains no live Lix handle. Use your framework's safe serialization for embedding it in HTML. Rendering and initial hydration need no database reads. A browser Lix can connect afterward to enable subscriptions and editing. Prepare the session on the requested branch; `loadAtelier` does not change a borrowed session's branch.

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

const initialState = await loadAtelier({
	lix,
	extensions,
	location: { view: "summary" },
});
<Atelier
	initialState={initialState}
	lix={browserLix}
	extensions={extensions}
/>;
```

Register the same trusted extensions on the server and browser. Loaders return plain JSON; components receive `{ data, atelier, view }`. Components must support server rendering and can initialize browser editors in effects while retaining their initial content. `fileExtensions` associates an extension with file types. Reusing a built-in extension ID replaces that built-in view.

Inside an extension component, `useAtelierConnected()` reports when the borrowed live Lix session is connected. Gate imperative host commands such as `atelier.documents.open(path)` and queries not included in the prepared state on this value. It is false during prepared rendering and connection validation, then updates to true; rendering prepared content does not need to wait.

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
