# Atelier web preview

This is the browser host for the embedded Atelier app. It uses the Lix SDK's
in-memory browser backend, which runs the Lix engine and WASM plugins in a
worker.

```bash
pnpm --dir preview/web dev
```

The preview is a regular Vite app. It intentionally has no Electron bridge or
filesystem backend.

Files under `seed/` are inserted into a fresh in-memory Lix workspace at
startup. Markdown fixtures and their local assets live together under
`seed/markdown-extension/`, matching the isolated `/markdown-extension/`
directory in the seeded workspace.

## Cloudflare preview deployments

The preview build is uploaded as a Worker version with static assets. It is not
deployed to production traffic. In Cloudflare Workers Builds, use these commands
from the repository root:

- Build command: `pnpm build:preview`
- Deploy command: `pnpm deploy:preview`
- Non-production branch deploy command: `pnpm deploy:preview`

Enable builds for non-production branches to get a versioned preview URL for
each pull request. Both deploy commands only upload immutable Worker versions;
they never promote a version to production traffic. The build requires Node.js
22, which is pinned in the repository's `.node-version` file.

Workers Static Assets limits individual files to 25 MiB. The production build
therefore stores the Lix WASM files precompressed, and the Worker serves them
with the standard `Content-Encoding: gzip` response header.
