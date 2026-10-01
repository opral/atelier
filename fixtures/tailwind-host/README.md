# Tailwind host CSS contract

Run `pnpm build`, `pnpm exec playwright install chromium`, then
`pnpm test:styles`. On a Linux CI image, use
`pnpm exec playwright install --with-deps chromium`.

The test packs Atelier, extracts it outside the source tree, verifies every CSS
export exists, and compiles a host utility sheet using the packed Tailwind
adapter with automatic detection disabled. It checks desktop and phone layout
in both stylesheet orders, inherited token overrides, scoped dark mode, portal
styling and the scoped reset's utility override contract in Chromium. It also
checks a no-Tailwind consumer using the standalone stylesheet.
