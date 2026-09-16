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
  `added | modified | removed`. Every view renders its own: in place where the
  format allows it, and before beside after (`DiffSides`) where it does not —
  images, PDFs, videos, scenes, HTML artifacts. Each side reads one commit,
  assets included. The shell hands both refs to every view and decides nothing
  by file type.

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

## Design tokens: one vocabulary, plain CSS

`src/shell/theme.css` is the design system: ~110 `--at-*` custom properties on
`:root, :host`, each with its dark value in `light-dark()` and a comment saying
when to use it. It is plain CSS — no build step, no framework — so the shell,
every extension, the static render, a chat card, and a host page all read the
same file. `src/shell/tailwind.css` is an optional adapter: `@theme inline`
points utilities at the same values, so `bg-panel` and `text-fg-muted` exist
and `bg-red-500` does not.

The rules, which `pnpm tokens:check` enforces (a failure names the nearest token):

- A colour literal (`#hex`, `rgb()`, `oklch()`…) is written in `theme.css` and
  nowhere else. Canvas code that cannot read `var()` keeps a fallback marked
  `token-literal: <why>` on the same line, equal to the token's light value.
- In CSS, say `var(--at-…)`. In `className`, say the adapter's name
  (`bg-panel`, `border-border-subtle`, `text-danger`). Never `bg-[var(…)]`,
  never a stock palette class.
- Text and icons share the `fg` scale: `fg`, `fg-muted`, `fg-subtle`, `fg-faint`.
  Surfaces: `bg` (canvas), `panel` (islands), `bg-subtle`, `bg-hover`,
  `bg-active`. Edges: `border`, `border-subtle`, `border-strong`, `ring`.
  Brand: `accent`, `accent-hover`, `accent-on`, `accent-subtle`, `link`.
  Status: `danger|success|warning` with `-subtle` and `-border`. Diff:
  `diff-added|removed|modified` with `-subtle`, plus `diff-moved`,
  `diff-conflict`. Dark chrome over the UI: `overlay-*`.
- A second name for a role that has one is a bug, not a token. If no token
  fits, add one to `theme.css` with its "use for" comment — do not restate a
  value, and do not alias without saying why.
- A component's own variables (`--markdown-*`, `--csv-*`) are declared on its
  root and reference tokens; they are never a place to hide a colour.
- Dark mode is `color-scheme: dark` on an ancestor (`.dark`), nothing else.
  A host rebrands by redeclaring tokens on `:root`; it never overrides
  component classes.

`src/shell/document.css` is the one document stylesheet: how a Markdown
document looks, scoped to `.atelier-document`, which the editor's ProseMirror
root and the static render's wrapper both carry. The editor's own sheet never
restates a rule from it; the card sets its density with one declaration,
`--atelier-doc-font-size: 14px`, and every size in the sheet is an em of it.

`src/shell/theme.generated.ts` and `document.generated.ts` are verbatim copies
of `theme.css` and `document.css` for the DOM-free render entry, made by
`pnpm run tokens`; the build fails if either is stale. The tokens sit on
`:root` on purpose: declared on `.atelier-render` they would beat anything a
host sets on an ancestor.

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
