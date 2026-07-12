# Atelier

### The embeddable lix workspace

Atelier is a workspace UI — editor, files, history, and diffs — that mounts into any host application. Hosts bring their own [lix](https://github.com/opral/lix); Atelier renders the space to work in it.

Atelier is the workspace engine inside any host. The included web preview demonstrates a browser app backed by Lix.

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
const atelier = createAtelier({ lix });

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
await atelier.files.open("/notes/idea.md");
await atelier.files.create();
await atelier.files.closeActive();

const unsubscribe = atelier.files.subscribe(() => {
	const { ready, active, open } = atelier.files.getSnapshot();
	console.log({ ready, active, open });
});

await atelier.diff.open({
	before: beforeCommitId,
	after: afterCommitId,
	source: { kind: "agent", agent: "claude" },
});
```

File commands issued before `<Atelier>` mounts are queued and executed in
order once the shell is ready. `getSnapshot()` returns an immutable external
store snapshot: `active` is the active document path and `open` contains all
open document paths.

Host extensions are passed as manifest/runtime registrations. A host
registration whose manifest uses a bundled id replaces that bundled view; for
example, an `atelier_history` registration can provide host-specific history
UI. Its runtime receives the same revision controls as the bundled History
view through `atelier.revisions.current`, `.show(...)`, and `.clear()`.

The target runtime is the browser. Atelier's fixed slots let a host fill bounded
navbar regions while Atelier retains ownership of the workspace chrome.

## What's in the workspace

| Feature      | Description                                     |
| ------------ | ----------------------------------------------- |
| Editor       | Markdown-native writing surface.                |
| Files        | Browse and open the files in the lix workspace. |
| HTML         | Run self-contained interactive HTML artifacts.  |
| Inline diffs | Keep or undo edits with word-level context.     |
| History      | Inspect checkpoints and restore earlier drafts. |

## Powered by Lix

Atelier's change control is powered by [Lix](https://github.com/opral/lix), a version control system that can handle any file format and is designed for building applications on top of.

## Status

Atelier exposes one workspace instance and a React view for rendering it. The development preview lives under `preview/web/`.

## License

Atelier is released under the [MIT License](./LICENSE).
