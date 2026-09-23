import { configDefaults, defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import path from "node:path";

// Vitest resolves this workspace link to its real path before applying
// dependency externalization. Keep the linked SDK in Node so its import.meta.url
// continues to locate native bindings and bundled plugin files correctly.
const linkedSdkExternal = (() => {
	try {
		const sdkPath = realpathSync(
			path.resolve(__dirname, "node_modules/@lix-js/sdk"),
		).replaceAll("\\", "/");
		const escapedPath = sdkPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`^${escapedPath}(?:/|$)`);
	} catch {
		return null;
	}
})();

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
				external: [
					"@lix-js/sdk",
					/\/vendor\/lix\/packages\/js-sdk\//,
					...(linkedSdkExternal ? [linkedSdkExternal] : []),
				],
			},
		},
		environment: "happy-dom",
		globals: true,
		setupFiles: ["setup-tests.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		exclude: [
			...configDefaults.exclude,
			".claude/**",
			"vendor/**",
			"scripts/**",
			// Published consumer SSR runs separately in plain Node.
			"fixtures/**",
		],
	},
});
