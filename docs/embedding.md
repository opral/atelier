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

## The central panel: browser-style tabs

The central panel is the main content area between the left and right side
panels. It is **always** a tab strip with a pinned home — the one UX
primitive shared by every host.

```ts
// Default: the Files view is the pinned home tab.
createAtelier({ lix });

// Custom home: a host extension pins as the permanent first tab; the
// Files view moves to the sidebar since the home owns the central landing.
createAtelier({
	lix,
	extensions: [homeExtension, dirExtension],
	centralPanel: {
		home: { extensionId: "my_home" },
	},
});
```

Without a configured home the **Files view is the home tab** — same rules,
zero configuration. With a custom home, the Files view automatically lives in
the sidebar instead.

The central island keeps multiple content views open. The model is
deliberately browser-like:

- **`home`** pins the named extension as the permanent first tab. It cannot be
  closed, dragged out, or replaced by navigation — like a browser's home
  button. When it is not the active tab it compacts to an icon-only chip.
- **Navigation is in-place.** `documents.open(path)` first activates an
  existing tab already showing `path`; otherwise it **replaces the active
  content tab** (the tab label follows the location). If the pinned home tab
  is active — or there is no content tab — a new content tab is appended
  beside it instead.
- **New tabs are explicit.** `documents.open(path, { newTab: true })` always
  appends a new tab at the end of the strip (hosts map ⌘-click to this).
  Newly created documents also open in their own tab. There is deliberately
  no tab-strip `＋` — the pinned home is the place new tabs come from.
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
	hidden: true, // exclude from the side panels' "+" add-view menus
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
	newTab: false, // default: navigate in place
	panel: "central", // default: "central"
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
