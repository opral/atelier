# Atelier

### The embeddable lix workspace

Atelier is a workspace UI — editor, files, history, and diffs — that mounts into any host application. Hosts bring their own [lix](https://github.com/opral/lix); Atelier renders the space to work in it.

Atelier is to [Flashtype](https://flashtype.ai) what Monaco is to VS Code and Chromium is to Chrome: the engine inside. Flashtype (Electron, macOS) is one host. A browser app pointing at a remote lix is another. Same workspace, any shell.

## Why "Atelier"?

**Atelier** (French, _[atəlje]_) is an artist's workshop — the private studio where an artist and their assistants make the work. Not the gallery where it's shown, not the storage where it's kept: the room where the work actually happens.

That's this component's job. Lix holds the workspace — the files, the history, every change. Atelier is the room you step into to work on it.

## Usage

```ts
import { openLix } from "@lix-js/sdk";
import { createAtelier } from "@opral/atelier";

// The host creates and owns the lix.
const lix = await openLix();

createAtelier({
	element: document.getElementById("mount"),
	lix,
});
```

The target runtime is the browser. Anything that can hand Atelier a DOM element and a lix can host it — an Electron renderer, a web app, a preview deployment.

## What's in the workspace

| Feature      | Description                                     |
| ------------ | ----------------------------------------------- |
| Editor       | Markdown-native writing surface.                |
| Files        | Browse and open the files in the lix workspace. |
| Inline diffs | Keep or undo edits with word-level context.     |
| History      | Inspect checkpoints and restore earlier drafts. |

## Powered by Lix

Atelier's change control is powered by [Lix](https://github.com/opral/lix), a version control system that can handle any file format and is designed for building applications on top of.

## Status

Atelier exposes the minimal `createAtelier({ element, lix })` entry point. The Electron development preview is isolated under `preview/electron/`; the Atelier runtime itself targets the browser.

## License

Atelier is released under the [MIT License](./LICENSE).
