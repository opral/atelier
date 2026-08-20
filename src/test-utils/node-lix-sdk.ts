import type {
	Lix,
	OpenLixOptions as SdkOpenLixOptions,
	SqlParam,
} from "@lix-js/sdk";

export type { Lix } from "@lix-js/sdk";

type OpenLixKeyValueEntry = {
	key: string;
	value: SqlParam;
	lixcol_untracked?: boolean;
	lixcol_global?: boolean;
};

type OpenTestLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkModule = typeof import("@lix-js/sdk");

let sdkModulePromise: Promise<SdkModule> | undefined;

export async function openLix(options: OpenTestLixOptions = {}): Promise<Lix> {
	const { keyValues, ...sdkOptions } = options;
	const sdk = await loadSdk();
	const lix = await sdk.openLix(sdkOptions);
	if (Array.isArray(keyValues)) {
		await seedKeyValues(lix, keyValues);
	}
	return lix;
}

async function loadSdk(): Promise<SdkModule> {
	if (!sdkModulePromise) {
		sdkModulePromise = import("@lix-js/sdk");
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
		await lix.execute(
			"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, $3, $4)",
			[
				entry.key,
				entry.value,
				entry.lixcol_global ?? true,
				entry.lixcol_untracked ?? true,
			],
		);
	}
}
