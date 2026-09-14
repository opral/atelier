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
- **shell** — arranges areas. **The shell owns everything remembered between
  views**: what is open, in which area, which tab, which diff session, what
  survives reload. A view remembers nothing. If the thing must persist across
  views, it is shell; otherwise it is a view.
- **document** — a file open in the main area.
- **diff** — two refs and the files between them, in `lix_diff`'s words:
  `added | modified | removed`, counted in entities.

## The static entry is a promise

`@opral/atelier/render` runs where there is no DOM — a Cloudflare Worker, a
node script. Import the concrete module you need, never a barrel: the bridge
barrel carries the editor extensions, which carry mermaid, katex and
cytoscape, and one such import took the closure from 234 kB to 5.4 MB without
erroring. `scripts/render-entry.test.mjs` walks the built closure and fails on
React, DOM globals, or size — run `pnpm build` before it.

## Colours come from tokens

`src/render/tokens.generated.ts` is generated from `src/shell/theme.css` by
`pnpm run tokens`, and the build fails if it is stale. Static styles use
`var(--atelier-*)` and no literals, so the app and a chat card cannot drift and
a host retints by redefining a custom property.

## Not ours

The Lix handle, routing, auth, and the product's chrome belong to the host.
