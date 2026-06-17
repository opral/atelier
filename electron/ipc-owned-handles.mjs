export function createOwnedHandleStore(describeHandle) {
	const handles = new Map();

	return {
		set(id, ownerId, value) {
			handles.set(id, { ownerId, value });
		},
		get(id, ownerId) {
			const handle = handles.get(id);
			if (!handle || handle.ownerId !== ownerId) {
				throw new Error(`${describeHandle} handle does not exist or is closed`);
			}
			return handle.value;
		},
		getOptional(id, ownerId) {
			const handle = handles.get(id);
			if (!handle || handle.ownerId !== ownerId) {
				return undefined;
			}
			return handle.value;
		},
		delete(id, ownerId) {
			const handle = handles.get(id);
			if (!handle || handle.ownerId !== ownerId) {
				return undefined;
			}
			handles.delete(id);
			return handle.value;
		},
		valuesForOwner(ownerId) {
			return [...handles.entries()]
				.filter((entry) => entry[1].ownerId === ownerId)
				.map(([id, handle]) => ({ id, value: handle.value }));
		},
		clearOwner(ownerId) {
			for (const [id, handle] of handles.entries()) {
				if (handle.ownerId === ownerId) {
					handles.delete(id);
				}
			}
		},
		values() {
			return [...handles.values()].map((handle) => handle.value);
		},
		clear() {
			handles.clear();
		},
	};
}
