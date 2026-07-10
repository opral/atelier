# Atelier web preview

This is the browser host for the embedded Atelier app. It uses the Lix SDK's
in-memory browser backend, which runs the Lix engine and WASM plugins in a
worker.

```bash
pnpm --dir preview/web dev
```

The preview is a regular Vite app. It intentionally has no Electron bridge or
filesystem backend.

Files under `seed/` are imported as text and inserted into a fresh in-memory
Lix workspace at startup. `seed/README.md` is opened automatically as the
visual Markdown fixture.
