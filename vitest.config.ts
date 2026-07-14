import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	ssr: {
		external: ["@lix-js/sdk"],
	},
	server: {
		fs: {
			allow: [path.resolve(__dirname, "../..")],
		},
	},
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	test: {
		server: {
			deps: {
				external: ["@lix-js/sdk", /\/vendor\/lix\/packages\/js-sdk\//],
			},
		},
		environment: "happy-dom",
		globals: true,
		setupFiles: ["setup-tests.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		exclude: [...configDefaults.exclude, ".claude/**"],
	},
});
