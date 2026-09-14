import type { AreaState, ExtensionInstance } from "../extension-runtime/types";

const deepCloneValue = <T>(input: T): T => {
	if (Array.isArray(input)) {
		return input.map((item) => deepCloneValue(item)) as unknown as T;
	}

	if (input instanceof Date) {
		return new Date(input.getTime()) as unknown as T;
	}

	if (input instanceof Map) {
		return new Map(
			Array.from(input.entries(), ([key, value]) => [
				deepCloneValue(key),
				deepCloneValue(value),
			]),
		) as unknown as T;
	}

	if (input instanceof Set) {
		return new Set(
			Array.from(input.values(), (value) => deepCloneValue(value)),
		) as unknown as T;
	}

	if (input && typeof input === "object") {
		return Object.fromEntries(
			Object.entries(input as Record<string, unknown>).map(([key, value]) => [
				key,
				deepCloneValue(value),
			]),
		) as T;
	}

	return input;
};

/**
 * Returns a view instance clone with deep-cloned state to keep transitions
 * immutable when moving tabs between areas.
 *
 * @example
 * const cloned = cloneExtensionInstance(panelState, "files-1");
 */
export const cloneExtensionInstance = (
	area: AreaState,
	instance: string,
): ExtensionInstance | null => {
	const view = area.views.find((entry) => entry.instance === instance);
	if (!view) return null;
	return {
		...view,
		state: view.state ? deepCloneValue(view.state) : undefined,
	};
};

export const reorderPanelExtensionsByIndex = (
	area: AreaState,
	fromIndex: number,
	toIndex: number,
): AreaState => {
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= area.views.length ||
		toIndex >= area.views.length
	) {
		return area;
	}

	const views = area.views.slice();
	const [moving] = views.splice(fromIndex, 1);
	views.splice(toIndex, 0, moving);
	return {
		views,
		activeInstance:
			area.activeInstance === moving.instance
				? moving.instance
				: area.activeInstance,
	};
};
