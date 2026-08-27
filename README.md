# Atelier

### The embeddable lix workspace

Atelier is a workspace UI — editor, files, and diffs — that mounts into any host application. Hosts bring their own [lix](https://github.com/opral/lix); Atelier renders the space to work in it.

Atelier is the workspace engine inside any host. The included web preview demonstrates a browser app backed by Lix.

Atelier is two things at once:

1. **The embeddable workspace shell** — mount `<Atelier />` and get the full editor, files, history, and review surface.
2. **A library of workspace components for building Lix applications** — the same extensions that power the shell are composable on their own. Building a Lix app and want to render Markdown, preview a file, or show a change? The extension that owns the file type does the rendering; your app owns the frame.

The second story is the direction: plug-and-play workspace UI, batteries included, powered by extensions.

### File previews (Quick Look)

Any surface in a host app can render a file — live, at a commit, or as a change — through the extension that owns its file type:

```tsx
import { AtelierFilePreview } from "@opral/atelier";

// The live document.
<AtelierFilePreview lix={lix} fileId={id} filePath="/README.md" />

// The document as of a commit.
<AtelierFilePreview lix={lix} fileId={id} filePath="/README.md"
	targetCommitId={commitId} />

// The change since a base — the same presentation the review surface shows.
<AtelierFilePreview lix={lix} fileId={id} filePath="/README.md"
	diff={{ baseCommitId }} />
```

Previews are chromeless by contract: no outer padding, no toolbars, no internal scrolling — the host owns the frame. Extensions opt in by setting `filePreview` on their definition; file-type resolution rides the same registry that routes opening files.

## Why "Atelier"?

**Atelier** (French, _[atəlje]_) is an artist's workshop — the private studio where an artist and their assistants make the work. Not the gallery where it's shown, not the storage where it's kept: the room where the work actually happens.

That's this component's job. Lix holds the workspace — the files, the history, every change. Atelier is the room you step into to work on it.

## Usage

```tsx
import { openLix } from "@lix-js/sdk";
import { Atelier, createAtelier } from "@opral/atelier";
import "@opral/atelier/style.css";

// The host creates and owns the lix.
const lix = await openLix();
const atelier = createAtelier({
	lix,
});

<Atelier
	instance={atelier}
	slots={{
		navbarStart: <a href="/">Host home</a>,
		navbarEnd: ({ currentFile }) =>
			currentFile ? <ShareButton file={currentFile} /> : null,
	}}
/>;
```

The instance is the programmatic workspace API and exposes its host-owned Lix:

```ts
atelier.lix;
await atelier.documents.open("/notes/idea.md");
await atelier.documents.startNew();
await atelier.documents.closeActive();

await atelier.diff.open({
	beforeCommitId,
	afterCommitId,
	source: { id: "claude" },
});
```

Document commands issued before `<Atelier>` mounts are queued and executed in
order once the shell is ready.

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
