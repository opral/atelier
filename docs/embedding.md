# Embedding Atelier

The public workspace API is `Atelier`, which requires an open Lix handle. The host owns Lix; Atelier owns the mounted UI runtime. While the host opens Lix, it can render the separate `AtelierSkeleton` with navbar slots and an opening message. This component renders only chrome and does not open a session or query repository data.

```tsx
<Atelier lix={lix} />
```

The shell mounts immediately. Views query the borrowed session as needed and display their own loading and error states. Static document rendering is a separate API: `toHtml` from `@opral/atelier/render`, given authorized file bytes.

Use `location={{ path: "/README.md" }}` or `location={{ view: "dashboard", state: {} }}` to control the active view. Supply `navigation={{ href, navigate }}` to map view activations to host URLs. The host opens/switches its Lix session on the requested branch before mounting.

`slots` supplies navbar regions and optional tab-strip presentation. Preferences, review status, and session state stores integrate host persistence. Those stores contain private UI state and should be scoped to a user and repository; do not expose it in publicly cached responses.

Host extensions are plain registrations with `id`, optional `load`, and `Component`. Components belong to the parent React tree and receive loaded JSON `data`, `atelier` commands, and `view`. A loader is rerun when its location or repository state changes. Obsolete requests are cancelled and stale results cannot replace a later view. Clean up editor instances, listeners, and object URLs in component effects.

The old `createAtelier`/`instance` host choreography, `Atelier.Shell`/`FileView` object API, and host extension `{ manifest, entry.mount }` registrations have been removed from the public API. Extension runtime commands remain available inside extension components. Private internal runtime construction is an implementation detail.

`loadAtelier`, `AtelierInitialState`, and the `initialState` prop have been removed. Do not preload a workspace snapshot before mounting. The static renderer does not evaluate repository extensions.
