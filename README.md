# Atelier

### The embeddable lix workspace

Atelier is a workspace UI — editor, files, and diffs — that mounts into any host application. Hosts bring their own [lix](https://github.com/opral/lix); Atelier renders the space to work in it.

Atelier is the workspace engine inside any host. The included web preview demonstrates a browser app backed by Lix.

Atelier is two things at once:

1. **The embeddable workspace shell** — mount `<Atelier.Shell lix={lix} />` and get the full editor, files, history, and review surface.
2. **A library of workspace components for building Lix applications** — the same extensions that power the shell are composable on their own. Building a Lix app and want to render Markdown, preview a file, or show a change? The extension that owns the file type does the rendering; your app owns the frame.

The second story is the direction: plug-and-play workspace UI, batteries included, powered by extensions.

### File previews (Quick Look)

Any surface in a host app can render a file — live, at a commit, or as a change — through the extension that owns its file type:

```tsx
import { Atelier } from "@opral/atelier";

// The live document.
<Atelier.FileView lix={lix} fileId={id} readOnly />

// The document as of a commit.
<Atelier.FileView lix={lix} fileId={id} filePath="/README.md"
	targetCommitId={commitId} />

// The change since a base — the same presentation the review surface shows.
<Atelier.FileView lix={lix} fileId={id} filePath="/README.md"
	targetCommitId={commitId} diff={{ baseCommitId }} />
```

`FileView` mounts the same file extension as the shell, without tabs or panels.

CSV files open in the built-in table view by default in both `Atelier.Shell` and `Atelier.FileView`. It supports optional typed columns, colored select options, compound filters, saved views, row selection, and text wrapping. Plain CSV files work without metadata or configuration. See [CSV properties](src/extensions/csv/README.md) for the file metadata format.
It discovers bundled, host-provided (`extensions`), and Lix-installed extensions
through the same registry. No separate preview implementation is required.
Pass `readOnly` to disable editing; omit it to edit. Use `onOpenFile` to route
document links in your host. The host owns the supplied Lix and closes it after unmount.

### Composing History

`Atelier.History` renders the built-in working changes and checkpoint timeline.
It includes its own Lix provider, loading state, and error boundary, so a host
extension can compose it inside a separate React root:

```tsx
import { Atelier } from "@opral/atelier";

// `atelier` is the runtime supplied to the extension's mount/update callbacks.
if (!atelier.diff) throw new Error("History requires a diff runtime");

<div className="flex min-h-0 flex-1 flex-col">
  <HostHistoryActions />
  <Atelier.History atelier={{ ...atelier, diff: atelier.diff }} />
</div>
```

Register the wrapper with `ATELIER_BUILTIN_EXTENSION_IDS.history` to replace the
shell's History view. Forward each `update` callback's runtime to the component
and unmount the React root on `dispose`. The component requires `lix`, `icons`,
and `diff`; the host owns Lix's lifecycle. Host messaging and actions stay in
the wrapper rather than in Atelier slots or the extension runtime.

## Why "Atelier"?

**Atelier** (French, _[atəlje]_) is an artist's workshop — the private studio where an artist and their assistants make the work. Not the gallery where it's shown, not the storage where it's kept: the room where the work actually happens.

That's this component's job. Lix holds the workspace — the files, the history, every change. Atelier is the room you step into to work on it.

## Usage

```tsx
import { openLix } from "@lix-js/sdk";
import { Atelier, type AtelierShellHandle } from "@opral/atelier";
import { createRef } from "react";
import "@opral/atelier/style.css";

// The host creates and owns the lix.
const lix = await openLix();
const shell = createRef<AtelierShellHandle>();

<Atelier.Shell
	lix={lix}
	ref={shell}
	slots={{
		navbarStart: <a href="/">Host home</a>,
		navbarEnd: <AccountMenu />,
	}}
/>;
```

The mounted shell exposes document and view commands through its ref:

```ts
await shell.current?.documents.open("/notes/idea.md");
await shell.current?.documents.startNew();
await shell.current?.documents.closeActive();
```

The ref becomes available at mount. Commands issued while the shell is loading
are queued until its runtime is ready. `Atelier.ShellSkeleton` provides the
workspace loading frame. Configuration (state stores, branch session, extensions,
events, and debug integration) is passed directly as shell props.

Host extensions are passed as `{ manifest, entry }` registrations. The host
manifest describes the view while `entry` supplies its already-loaded icon and
mount function; module paths belong only to workspace-installed extension
manifests. A registration using an id from `ATELIER_BUILTIN_EXTENSION_IDS`
replaces that bundled view.

The target runtime is the browser. Atelier's fixed slots let a host fill bounded
navbar regions while Atelier retains ownership of the workspace chrome.

## What's in the workspace

| Feature      | Description                                     |
| ------------ | ----------------------------------------------- |
| Editor       | Markdown-native writing surface.                |
| Files        | Browse and open the files in the lix workspace. |
| Drawings     | Sketch on an Excalidraw canvas (`.excalidraw`). |
| HTML         | Run self-contained interactive HTML artifacts.  |
| Inline diffs | Keep or undo edits with word-level context.     |

## Powered by Lix

Atelier's change control is powered by [Lix](https://github.com/opral/lix), a version control system that can handle any file format and is designed for building applications on top of.

## Status

Atelier exposes one workspace instance and a React view for rendering it. The development preview lives under `preview/web/`.

## License

Atelier is released under the [MIT License](./LICENSE).
