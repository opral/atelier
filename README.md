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
await atelier.diff.open({
	before: beforeCommitId,
	after: afterCommitId,
	source: { kind: "agent", agent: "claude" },
});
```

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
