# Embedding Atelier

The public workspace API is `Atelier`, with `loadAtelier` for prepared rendering. The host owns Lix; Atelier owns the mounted UI runtime.

```tsx
<Atelier lix={lix} />
```

For SSR, `await loadAtelier({ lix, location, extensions, readOnly })` produces portable initial state. Pass it to `<Atelier initialState={initialState} lix={browserLix} extensions={extensions} />`. The browser handle is optional until it connects. The same shell and extension components produce server HTML and hydrate it.

Use `location={{ path: "/README.md" }}` or `location={{ view: "dashboard", state: {} }}` to control the active view. Supply `navigation={{ href, navigate }}` to map view activations to host URLs. The host opens/switches its Lix session on the requested branch before preparation.

`slots` supplies navbar regions and optional tab-strip presentation. Preferences, review status, and session state stores integrate host persistence. Those stores contain private UI state and should be scoped to a user and repository; avoid including it in publicly cached initial state.

Host extensions are plain registrations with `id`, optional `load`, and `Component`. Components belong to the parent React tree and receive prepared JSON `data`, `atelier` commands, and `view`. A loader is rerun when its location or repository state changes. Obsolete requests are cancelled and stale results cannot replace a later view. Clean up editor instances, listeners, and object URLs in component effects.

The old `createAtelier`/`instance` host choreography, `Atelier.Shell`/`FileView` object API, and host extension `{ manifest, entry.mount }` registrations have been removed from the public API. Extension runtime commands remain available inside extension components. Private internal runtime construction is an implementation detail.

Only trusted bundled and host-registered extensions participate in SSR. Never evaluate an extension loaded from an untrusted repository on the application server.
