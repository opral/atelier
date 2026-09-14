# Atelier

**A UI toolkit for Lix: views over a lix, and a shell that arranges them.**

Read the README's opening before adding anything to this package. The rules
that are easy to break, and the reasons:

## The unit is a view, never a file type

A capability that only works for Markdown is a bug in the capability. Before
adding an export, ask whether it names a file type — if it does, it belongs
inside that type's extension, reached through `toHtml` (static) or the view
(mounted). This package once exported `./markdown-diff`; it should have been
a mode of the Markdown view from the start.

## The five primitives

- **view** — shows lix data. An extension contributes one; several instances
  may exist. `{ id, fileExtensions?, load(), Component }`.
- **area** — `left | main | right`, where a view sits. Not "panel": VS Code
  reserves that for the bottom region and Zed for a content unit.
- **shell** — arranges areas. **The shell owns what is shared between views**:
  what is open, in which area, which tab, which diff session. A view owns what
  is private to it, and it does persist — `view.preferences` is namespaced by
  extension id and saved with the workspace (the Files view remembers
  `showHiddenFiles` that way, History its scope). The axis is shared vs.
  private, not persisted vs. not.
- **document** — a file open in the main area.
- **diff** — two refs and the files between them, in `lix_diff`'s words:
  `added | modified | removed`, counted in entities.

## The static entry is a promise

`@opral/atelier/render` runs where there is no DOM — a Cloudflare Worker, a
node script. (The SSR path the README's Routing section describes is a
different thing: that renders the mounted shell on a server, with React.)
Import the concrete module you need, never a barrel: the bridge barrel
carries the editor extensions, which carry mermaid, katex and
cytoscape, and one such import took the closure from 234 kB to 5.4 MB without
erroring. `scripts/render-entry.test.mjs` walks the built closure and fails on
React, DOM globals, or size. It reads `dist/`, so `pnpm run ci` builds before
it runs and `pnpm test` (vitest) does not cover it — run `pnpm build` first if
you invoke it directly.

## Colours come from tokens

`src/render/tokens.generated.ts` is generated from `src/shell/theme.css` by
`pnpm run tokens`, and the build fails if it is stale. Static styles take every
**colour** from `var(--atelier-*)` — sizes and fonts are still literals — so
the app and a chat card cannot drift.

The tokens are declared on `:root`, deliberately. Declared on `.atelier-render`
they would beat anything a host sets on an ancestor, because a declaration on
the element wins over an inherited value, and every override would silently do
nothing.

## Two exceptions to be honest about

`@opral/atelier/file-icons` is a path→icon map: per-file-type, and a top-level
export. It is an asset, not a capability — it renders nothing and decides
nothing — which is why it is not a view. Anything that *renders* is.

`toHtml` covers Markdown and CSV. A view with no static mode says so
(`skipped: "unsupported"`); it is not a gap to route around with a new export.

## Not ours

The Lix handle, routing, auth, and the product's chrome belong to the host.
