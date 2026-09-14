# Atelier

**A UI toolkit for Lix: views over a lix, and a shell that arranges them.**

Read the README's opening before adding to this package. The rules below are
the ones that are easy to break, with the reason each exists.

## The unit is a view, not a file type

A capability that only works for Markdown is a bug in the capability. Before
adding an export, ask whether it names a file type. If it does, it belongs
inside that type's extension, reached through `toHtml` (static) or the view
(mounted). This package once exported `./markdown-diff`. It should have been a
mode of the Markdown view from the start.

## The five primitives

- **view** — shows lix data. An extension contributes one; several instances
  may exist. `{ id, fileExtensions?, load?, Component }`.
- **area** — `left | main | right`. Where a view sits. Not "panel": VS Code
  uses that word for the bottom region and Zed for a content unit.
- **shell** — arranges areas. **The shell owns what is shared between views**:
  what is open, in which area, which tab, which diff session. A view owns what
  is private to it, and that persists too — `view.preferences` is namespaced by
  extension id and saved with the workspace. The Files view keeps
  `showHiddenFiles` there; History keeps its scope. The question is shared vs.
  private, not persisted vs. not.
- **document** — a file open in the main area.
- **diff** — two refs and the files between them, in `lix_diff`'s words:
  `added | modified | removed`. A view that renders its own diff declares
  `"diff": true` in its manifest and is handed both refs. Every other view is
  mounted twice, before beside after, by the shell. Which file type is open
  decides nothing: the shell asks the view, not the path.

## The static entry is a promise

`@opral/atelier/render` runs where there is no DOM: a Cloudflare Worker, a node
script. (The SSR path in the README's Routing section is a different thing. It
renders the mounted shell on a server, with React.)

Import the concrete module you need, never a barrel. The bridge barrel carries
the editor extensions, which carry mermaid, katex and cytoscape. One such
import took the closure from 234 kB to 5.4 MB and did not error.

`scripts/render-entry.test.mjs` walks the built closure and fails on React, DOM
globals, or size. It reads `dist/`, so `pnpm run ci` builds first and `pnpm
test` (vitest) does not cover it. Run `pnpm build` before calling it directly.

## Colours come from tokens

`src/render/tokens.generated.ts` is generated from `src/shell/theme.css` by
`pnpm run tokens`. The build fails if it is stale.

Static styles take every **colour** from `var(--atelier-*)`. Sizes and fonts
are still literals. This keeps the app and a chat card from drifting apart.

The tokens are declared on `:root` on purpose. On `.atelier-render` they would
beat anything a host sets on an ancestor, because a declaration on the element
wins over an inherited value, and every override would silently do nothing.

## One strict reader for "is this text?"

`fileText` in `src/lib/decode-file-data.ts` refuses bytes that are not UTF-8.
Every view that can decline uses it. `decodeFileDataToText` is the lossy one,
for an open editor that must render something, and its name says so. Do not add
a third.

## Two exceptions to be honest about

`@opral/atelier/file-icons` is a path→icon map: per-file-type, and a top-level
export. It is an asset, not a capability — it renders nothing and decides
nothing — which is why it is not a view. Anything that *renders* is.

`toHtml` covers Markdown and CSV. A view with no static mode says so
(`skipped: "unsupported"`). That is not a gap to route around with a new
export.

## Not ours

The Lix handle, routing, authentication, and the product's chrome belong to the
host.
