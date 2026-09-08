## Contributing

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v22 or higher)
- [pnpm](https://pnpm.io/) (v10 or higher)

> [!INFO]
> If you are developing on Windows, you need to use [WSL](https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux).

### Development

1. Install dependencies from the repo root: `pnpm install`
2. Start the app: `pnpm run dev`

### Example

> [!INFO]
> `@glideapps/glide-data-grid` is used for the CSV viewer. Its published peer range has not caught up to React 19, so `package.json` intentionally allows the React 19 peer for Glide and lists Glide's peer packages explicitly.

1. `pnpm install`
2. `pnpm run dev`

### Design tokens

`src/shell/theme.css` is the only place that may hold a literal color, shadow, radius, size, or duration. Components and extension stylesheets consume tokens; they do not restate values.

- **Semantic over primitive.** Use role tokens (`--color-text-tertiary`, `--color-bg-action-primary`, `--color-ring-focus-visible`) rather than palette steps (`--color-neutral-500`, `--color-brand-700`). Palette steps appear outside `theme.css` only where a third-party library needs its own variables bridged (Excalidraw). If no role token fits, add one to `theme.css` instead of reaching for a step.
- **No fallbacks in `var()`.** `var(--color-x, #hex)` hides a missing token; `theme.css` is always loaded under `.atelier-root`, so reference the token bare.
- **Dark chrome uses the inverse set.** Anything floating dark over the light UI (review pill, media frames, player controls) uses `--color-bg-inverse*`, `--color-text-inverse-*`, `--color-border-inverse*`, and `--shadow-inverse`. Do not hand-mix warm grays.
- **Code uses the syntax set.** Text editor and markdown code blocks share `--color-syntax-*`.
- **Scales.** Radii: `--radius-tag` (3px) inside controls, `--radius-control` (7px) for buttons, inputs, menu items, `--radius-panel` (8px) for popovers and panels; Tailwind exposes them as `rounded-tag`, `rounded-control`, `rounded-panel`. UI type: `text-ui-xs` (11px), `text-ui-sm` (11.5px), `text-ui` (12.5px), `text-ui-lg` (13px), each with its line height; document typography in the markdown extension keeps its own editorial scale. Motion: `--duration-fast`, `--duration-base`, `--duration-slow`. Control rows follow `--atelier-panel-header-height`.
- **Focus.** `outline: 2px solid var(--color-ring-focus-visible)` with `outline-offset: 1px` (or `-2px` inside clipped containers). Avoid box-shadow rings.
- **There is no dark theme.** Semantic tokens have light values only; nothing toggles `.dark`. Adding dark support means giving the semantic tokens dark values in `theme.css`, not overriding component styles.

### Opening a PR

1. `pnpm run ci`

### Preparing vendored Lix

`pnpm run build:lix --browser-only` first reuses browser SDK and OPFS outputs from the Lix CI pipeline for the exact `vendor/lix` commit. Downloads are checked against the GitHub artifact SHA-256 digest, workflow revision, and browser manifest. A prepared output is reused only for the same clean source revision and when required files are present.

Local development defaults to `ATELIER_LIX_ARTIFACTS=auto`: missing artifacts fall back to the existing Rust/WASM source build. Use `ATELIER_LIX_ARTIFACTS=off` to force a source build when editing vendored Lix. `pnpm run build:lix` also prepares the native binding needed by tests; browser artifacts do not replace that platform-specific build.

Authentication uses `LIX_CI_ARTIFACT_GITHUB_TOKEN`, then `GH_TOKEN`, `GITHUB_TOKEN`, or an authenticated local `gh` CLI. The token needs **Actions: read** for `opral/lix`. It is used only during artifact preparation, never included in the browser bundle.

### Cloudflare preview builds

Use these settings for the existing `atelier-preview` Worker:

- Build command: `pnpm run build:preview`.
- Non-production branch deploy command: `pnpm run deploy:preview` (`wrangler versions upload`).
- Production branch deploy command: `pnpm run deploy:preview` as well. This preview-only Worker uploads versions without promoting production traffic.
- Build secret: `LIX_CI_ARTIFACT_GITHUB_TOKEN`, containing a GitHub token with **Actions: read** access to `opral/lix`. Configure it in the Worker's **Build variables and secrets**, not its runtime bindings. Enable it for the preview build trigger as well as production if they use separate settings.

Cloudflare sets `WORKERS_CI=1`, which defaults artifact mode to `only`. A missing, expired, corrupt, or unauthorized artifact fails with an actionable error instead of starting a Rust build on the deployment runner. `ATELIER_LIX_ARTIFACTS` can explicitly override this policy; `LIX_CI_ARTIFACT_WAIT_SECONDS` optionally waits for an in-progress Lix workflow (default: `0`).

When bumping `vendor/lix`, select a commit whose browser CI job has published `lix-browser-sdk-<full-commit-sha>`. The Lix producer retains these artifacts for 90 days, so an old pin eventually needs a fresh producer run or a tested pin update. The initial artifact-enabled pin changes only upstream CI files from Atelier's previous revision.

`build:preview` initializes submodules, installs the matching browser outputs, builds the frontend, and compresses WASM for the existing Worker asset handler. No Rust toolchain is needed on the artifact path.

Run `pnpm run test:build-scripts` for artifact validation and cache regression tests. `pnpm run ci` includes these checks along with the normal library, native tests, and consumer build.

References: [Cloudflare build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [GitHub artifact download permissions](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact).
