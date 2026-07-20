# Embedding Atelier

Atelier is an embeddable workspace shell. A host application creates an
instance with `createAtelier(options)`, renders it with `<Atelier instance />`,
and injects its own content through three surfaces:

1. **Options** — capability flags that select the shell's layout behavior.
2. **Extensions** — host-registered views mounted inside Atelier's panels.
3. **Slots** — host-owned React nodes rendered into named chrome positions.

This mirrors the pattern of other embeddable surfaces (Monaco's
`create(element, options)` capability flags, VS Code's contribution points,
shadcn/Radix slot composition): the shell owns layout and interaction
machinery, the host owns content and navigation policy.

## The central panel: two modes

The central panel is the main content area between the left and right side
panels. It operates in one of two modes:

### Document slot (default)

```ts
createAtelier({ lix });
```

The central island hosts exactly **one** view at a time — a document editor or
the Files landing view. There is no tab strip; switching files happens from
the Files view. `documents.open(path)` replaces the current view. This is the
mode FlashType uses.

### Tabbed (`centralPanel.mode: "tabs"`)

```ts
createAtelier({
  lix,
  extensions: [homeExtension, dirExtension],
  centralPanel: {
    mode: "tabs",
    home: { extensionId: "my_home" },
  },
});
```

The two modes are a discriminated union — a `home` cannot be configured
without tabs. With a pinned home configured, the Files view automatically
lives in the sidebar (`filesViewMode` is treated as `"sidebar"`), since the
home view owns the central landing.

The central island renders a tab strip and keeps multiple content views open.
The model is deliberately browser-like:

- **`home`** pins the named extension as the permanent first tab. It cannot be
  closed, dragged out, or replaced by navigation — like a browser's home
  button. When it is not the active tab it compacts to an icon-only chip.
- **Navigation is in-place.** `documents.open(path)` first activates an
  existing tab already showing `path`; otherwise it **replaces the active
  content tab** (the tab label follows the location). If the pinned home tab
  is active — or there is no content tab — a new content tab is appended
  beside it instead.
- **New tabs are explicit.** `documents.open(path, { newTab: true })` always
  appends a new tab (hosts map ⌘-click to this). The tab-strip `＋` button and
  newly created documents also open in their own tab.
- **Closing a tab** activates its neighbor; closing the last content tab lands
  on the pinned home.

## Extension placement

Extensions declare where they may be placed via their manifest:

```ts
const manifest = {
  apiVersion: 1,
  id: "my_dir",
  name: "Folder",
  placement: ["central"], // default: ["left", "right"]
  hidden: true,           // exclude from the side panels' "+" add-view menus
  multiInstance: true,
};
```

- `placement` gates the panel sides a view can occupy — add-view menus,
  drag-and-drop, and programmatic opens all respect it. The default (no
  `placement`) is the side panels. Document editors are always central.
- `hidden` keeps an extension out of the add-view menus while remaining
  mountable programmatically — right for views that only open through
  navigation (a folder view) or configuration (a pinned home).

## Programmatic view control

Documents (files) are driven by the existing `instance.documents` API. Non-file
views — including a host's central content views — are driven by
`instance.views`:

```ts
await instance.views.open("my_dir", {
  state: { path: "/assets", atelier: { label: "assets" } },
  instanceId: "my_dir:/assets", // stable identity for dedupe/activation
  newTab: false,                 // default: navigate in place
  panel: "central",              // default: "central"
});
```

`views.open` follows the same in-place rules as `documents.open`: an existing
instance with the same `instanceId` is activated (its state shallow-merged);
otherwise the active content tab is replaced, or a tab is appended when
`newTab` is set or home is active. The same `instanceId` is reported back on
`central_view_activated`, so hosts can correlate tabs with URLs. For side
panels the call behaves like the panel "+" menu (activate the existing
singleton or add the view) — `instanceId` and `newTab` are ignored there.
The id `"central-home"` is reserved for the configured home extension.

The same API is available to mounted extensions via
`atelier.views` on `AtelierExtensionRuntime`, so a host's home view can open
its folder view directly.

## Host navigation (URLs)

Atelier never touches the URL — the host owns routing. Two directions:

- **Shell → host:** the `central_view_activated` event fires whenever the
  active central view changes (open, tab click, close, restore). It carries
  `{ viewKind, instanceId, filePath, state }`; hosts map it to a URL (a
  document path, a folder view's `state.path`, or the home route).
- **Host → shell:** route handlers call `documents.open` / `views.open`.
  Both are idempotent — opening the already-active location is a no-op — so
  browser back/forward loops cleanly.

## Compatibility

All of this is additive. With no `centralPanel` option the shell behaves
exactly as before (single document slot, no tab strip), so existing hosts
(FlashType) are unaffected until they opt in.
