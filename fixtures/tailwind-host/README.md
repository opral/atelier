# Single stylesheet contract

Run `pnpm build`, `pnpm exec playwright install chromium`, then
`pnpm test:styles`. Linux CI can install Chromium with `--with-deps`.

The test packs Atelier outside the source tree and verifies `style.css` is its
only CSS export. A plain Vite consumer needs no Tailwind plugin. An independent
Tailwind host generates its own utilities without scanning Atelier. Chromium
checks phone and desktop layouts in both stylesheet orders, mounted and static
views, private utility and animation names, inherited token overrides, portal
styling, scoped resets and light/dark mode.
