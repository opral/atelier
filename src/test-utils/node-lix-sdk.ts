import { createRequire } from "node:module";
import { resolve } from "node:path";
import type {
	BundledPluginArchive,
	Lix,
	OpenLixOptions as SdkOpenLixOptions,
	SqlParam,
} from "../../submodule/lix/packages/js-sdk/dist/index.js";

export type {
	Lix,
	LixTransaction as SqlTransaction,
} from "../../submodule/lix/packages/js-sdk/dist/index.js";
export type { BundledPluginArchive };

type OpenLixKeyValueEntry = {
	key: string;
	value: SqlParam;
	lixcol_untracked?: boolean;
} & (
	| {
			lixcol_branch_id: string;
			lixcol_global: boolean;
	  }
	| {
			lixcol_branch_id?: undefined;
			lixcol_global?: boolean;
	  }
);

type OpenTestLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkModule =
	typeof import("../../submodule/lix/packages/js-sdk/dist/index.js");

let sdkModulePromise: Promise<SdkModule> | undefined;
const require = createRequire(import.meta.url);

export async function openLix(options: OpenTestLixOptions = {}): Promise<Lix> {
	const { keyValues, ...sdkOptions } = options;
	const sdk = await loadSdk();
	const lix = await sdk.openLix(sdkOptions);
	if (Array.isArray(keyValues)) {
		await seedKeyValues(lix, keyValues);
	}
	return lix;
}

export async function bundledPluginArchives(): Promise<BundledPluginArchive[]> {
	const sdk = await loadSdk();
	return await sdk.bundledPluginArchives();
}

async function loadSdk(): Promise<SdkModule> {
	if (!sdkModulePromise) {
		const sdkPath = resolve(
			process.cwd(),
			"submodule/lix/packages/js-sdk/dist/index.js",
		);
		// Require the built SDK entry so Node, not Vite, owns the native addon's
		// import.meta.url handling.
		sdkModulePromise = Promise.resolve(require(sdkPath) as SdkModule);
	}
	return await sdkModulePromise;
}

async function seedKeyValues(
	lix: Lix,
	keyValues: ReadonlyArray<OpenLixKeyValueEntry>,
): Promise<void> {
	for (const entry of keyValues) {
		if (!entry || typeof entry.key !== "string") {
			continue;
		}
		if (typeof entry.lixcol_branch_id === "string") {
			if (typeof entry.lixcol_global !== "boolean") {
				throw new TypeError(
					"branch-scoped keyValues entries require lixcol_global",
				);
			}
			await lix.execute(
				"INSERT INTO lix_key_value_by_branch (key, value, lixcol_branch_id, lixcol_global, lixcol_untracked) VALUES ($1, $2, $3, $4, $5)",
				[
					entry.key,
					entry.value,
					entry.lixcol_branch_id,
					entry.lixcol_global,
					entry.lixcol_untracked ?? true,
				],
			);
			continue;
		}
		await lix.execute(
			"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
			[entry.key, entry.value],
		);
	}
}
