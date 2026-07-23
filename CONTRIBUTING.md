## Contributing

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v22 or higher)
- [pnpm](https://pnpm.io/) (v10 or higher)
- [Rustup](https://rustup.rs/) and Cargo
- `wasm-bindgen-cli` matching the version pinned by Lix (currently
  `cargo install wasm-bindgen-cli --version 0.2.122 --locked`)

> [!INFO]
> If you are developing on Windows, you need to use [WSL](https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux).

### Development

1. Clone the repository, including its pinned Lix submodule:
   `git submodule update --init --recursive`
2. Install dependencies from the repo root: `pnpm install`
3. Build the pinned Lix SDK: `pnpm run build:lix`
4. Start the app: `pnpm run dev`

### Example

> [!INFO]
> `@glideapps/glide-data-grid` is used for the CSV viewer. Its published peer range has not caught up to React 19, so `package.json` intentionally allows the React 19 peer for Glide and lists Glide's peer packages explicitly.

1. `git submodule update --init --recursive`
2. `pnpm install`
3. `pnpm run build:lix`
4. `pnpm run dev`

### Opening a PR

1. `pnpm run ci`
