import type { AtelierJsonValue } from "./extension-api";
import type { AtelierQuerySnapshot } from "./atelier-state";

const TAG = "__atelier_value__";

/** Internal codec preserves SQL byte arrays across ordinary JSON serialization. */
export function encodeAtelierValue(value: unknown): AtelierJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint")
		return { [TAG]: "bigint", value: String(value) };
	if (value instanceof Uint8Array)
		return { [TAG]: "bytes", value: Array.from(value) };
	if (Array.isArray(value)) return value.map(encodeAtelierValue);
	if (
		value &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		const encoded = Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				encodeAtelierValue(item),
			]),
		);
		return TAG in value ? { [TAG]: "object", value: encoded } : encoded;
	}
	throw new TypeError(
		"Atelier preparation requires JSON data, SQL bytes, or bigint values.",
	);
}

export function decodeAtelierValue(value: AtelierJsonValue): unknown {
	if (Array.isArray(value)) return value.map(decodeAtelierValue);
	if (value && typeof value === "object") {
		const object = value as Record<string, AtelierJsonValue>;
		if (object[TAG] === "bytes")
			return new Uint8Array(object.value as number[]);
		if (object[TAG] === "bigint") return BigInt(object.value as string);
		if (object[TAG] === "object")
			return decodeObject(object.value as Record<string, AtelierJsonValue>);
		return decodeObject(object);
	}
	return value;
}

function decodeObject(
	value: Record<string, AtelierJsonValue>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, decodeAtelierValue(item)]),
	);
}

export function decodeAtelierQueries(queries: readonly AtelierQuerySnapshot[]) {
	return queries.map(({ sql, columns, params, rows }) => ({
		sql,
		columns,
		params: params.map(decodeAtelierValue),
		rows: rows.map(decodeAtelierValue),
	}));
}

export function atelierQueryKey(
	sql: string,
	params: readonly unknown[] = [],
): string {
	return JSON.stringify([sql, params.map(encodeAtelierValue)]);
}
