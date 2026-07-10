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

## Cloudflare preview deployments

The production build is deployed as a Worker with static assets. In Cloudflare
Workers Builds, use these commands from the repository root:

- Build command: `pnpm build:preview`
- Deploy command: `pnpm deploy`
- Non-production branch deploy command: `pnpm deploy:preview`

Enable builds for non-production branches to get a versioned preview URL for
each pull request. The build requires Node.js 22, which is pinned in the
repository's `.node-version` file.

Workers Static Assets limits individual files to 25 MiB. The production build
therefore stores the Lix WASM files precompressed, and the Worker serves them
with the standard `Content-Encoding: gzip` response header.
