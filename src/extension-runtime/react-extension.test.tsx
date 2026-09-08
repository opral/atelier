import { createContext, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Search } from "lucide-react";
import { createReactExtensionDefinition } from "./react-extension";
import type { ExtensionRuntime, ExtensionView } from "./types";

describe("createReactExtensionDefinition", () => {
	test("renders extension content on the server within the host's React context", () => {
		const Context = createContext("missing");
		const definition = createReactExtensionDefinition({
			manifest: { apiVersion: 1, id: "test", name: "Test" },
			description: "An extension",
			icon: Search,
			component: function Content({ data }) {
				return (
					<h1>
						{useContext(Context)}: {String(data)}
					</h1>
				);
			},
		});
		const Component = definition.Component!;
		const html = renderToStaticMarkup(
			<Context.Provider value="repository">
				<Component
					atelier={{} as ExtensionRuntime}
					view={{} as ExtensionView}
					data="prepared document"
				/>
			</Context.Provider>,
		);
		expect(html).toContain("repository: prepared document");
		expect(definition.mount).toBeUndefined();
	});
});
