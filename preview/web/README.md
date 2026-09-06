# Atelier web preview

This is the browser host for the embedded Atelier app. It uses the Lix SDK's
in-memory browser storage, which runs the Lix engine and WASM plugins in a
worker.

```bash
pnpm --dir preview/web dev
```

The preview is a regular Vite app. It intentionally has no Electron bridge or
filesystem storage.

Files under `seed/` are inserted into a fresh in-memory Lix workspace at
startup. Markdown fixtures and their local assets live together under
`seed/markdown-extension/`, matching the isolated `/markdown-extension/`
directory in the seeded workspace.

## Developer workflows

Preview builds show a hammer menu in the navbar, including deployed preview
versions. Open a Markdown file and choose a workflow to run a real Lix file write
plus completed agent-turn range; the normal Keep/Undo review flow should appear.

Agent hosts trigger the same flow by reading the active commit before a turn,
performing the file writes, reading the active commit afterward, and calling
`recordAgentTurnCommitRange(lix, range)` from `@opral/atelier`. An origin key by
itself does not create a review.

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

The build downloads the browser SDK and OPFS package already tested in Lix CI
for the exact `vendor/lix` revision. Add `LIX_CI_ARTIFACT_GITHUB_TOKEN` as a
Cloudflare **build secret**, with GitHub **Actions: read** permission for
`opral/lix`. It must be available to both the production-branch and
non-production-branch build triggers, not just the Worker runtime.

Workers Builds defaults to artifact-only preparation: it fails clearly on a
missing or unauthorized artifact instead of compiling Rust. Local builds retain
a source fallback. See [vendored Lix setup](../../CONTRIBUTING.md#preparing-vendored-lix)
for overrides, cache behavior, and artifact retention.

Workers Static Assets limits individual files to 25 MiB. The production build
therefore stores the Lix WASM files precompressed, and the Worker serves them
with the standard `Content-Encoding: gzip` response header.
