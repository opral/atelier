import { defineConfig } from "vite";

export default defineConfig({
	build: {
		// Preserve the inherited light-dark() design tokens in standalone.css.
		cssTarget: ["chrome123", "firefox120", "safari17.5"],
	},
});
