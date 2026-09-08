# Atelier

Atelier is an embeddable React workspace for [Lix](https://github.com/opral/lix): files, editors, history, and review in one component.

```tsx
import { Atelier } from "@opral/atelier";
import "@opral/atelier/style.css";

<Atelier lix={lix} location={{ path: "/README.md" }} />
```

The host owns the Lix handle and closes it after unmount. Atelier owns its UI, subscriptions, extension loading, and editor lifecycle.

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
<Atelier initialState={initialState} lix={browserLix} />
```

`initialState` contains the shell layout, prepared query results, and extension data. It contains no live Lix handle. Use your framework's safe serialization for embedding it in HTML. Rendering and initial hydration need no database reads. A browser Lix can connect afterward to enable subscriptions and editing. Prepare the session on the requested branch; `loadAtelier` does not change a borrowed session's branch.

## Routing

A location identifies a repository path or an extension view:

```tsx
<Atelier
  lix={lix}
  location={{ path: "/notes.md", branchId }}
  navigation={{
    href: location => repositoryUrl(location),
    fileHref: file => rawFileUrl(file),
    navigate: location => router.navigate(repositoryUrl(location)),
  }}
/>
```

The optional `fileHref({ path, branchId, commitId })` returns a raw file URL. It enables repository-relative Markdown images and native image, PDF, and video rendering during SSR, including files too large to inline. After hydration PDFs progressively enhance to the existing PDF.js canvas, page controls, and accessible page text using the raw URL and bounded range requests; no browser Lix connection or full-blob database read is required. A download link remains available if rendering fails. Serve the requested revision with the correct media content type and support HTTP ranges for large media. File revisions keep native playback stable when unrelated files change.

Extension locations use `{ view: "dashboard", state: { filter: "open" } }`. Native links use `href`, so documents remain navigable before JavaScript starts. Optional `slots`, state stores, branch session, and events integrate host controls without exposing a separate workspace runtime.

## Extensions

Extensions load data and render in Atelier's React tree:

```tsx
const extensions = [{
  id: "summary",
  name: "Summary",
  async load({ lix, signal }) {
    signal.throwIfAborted();
    const result = await lix.execute("SELECT count(*) AS count FROM lix_file");
    return { count: Number(result.rows[0].count) };
  },
  Component({ data }) {
    return <p>{data.count} files</p>;
  },
}];

const initialState = await loadAtelier({
  lix, extensions, location: { view: "summary" },
});
<Atelier initialState={initialState} lix={browserLix} extensions={extensions} />
```

Register the same trusted extensions on the server and browser. Loaders return plain JSON; components receive `{ data, atelier, view }`. Components must support server rendering and can initialize browser editors in effects while retaining their initial content. `fileExtensions` associates an extension with file types. Reusing a built-in extension ID replaces that built-in view.

Bundled Markdown, CSV, text, HTML, images, media, and drawings provide initial content. Markdown and CSV progressively initialize their interactive editors; drawings provide a basic SVG scene until Excalidraw is ready. Large media previews are deferred to avoid embedding unbounded binary data. Browser-installed repository extensions remain browser-only; the server does not execute arbitrary repository JavaScript.

See [embedding](docs/embedding.md) and [CSV properties](src/extensions/csv/README.md). The development preview is in `preview/web/`.

## License

[MIT](./LICENSE).

## Composable history

`Atelier.History` remains available to host extensions as `<Atelier.History atelier={atelier} />`.
