import { Extension, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@tiptap/pm/transform";

const assignIdsBeforeComposition = new PluginKey("assignIdsBeforeComposition");

function defaultGenId() {
	// Simple, readable id good enough for tests/runtime without external deps
	return (
		"id_" +
		Math.random().toString(36).slice(2, 8) +
		Date.now().toString(36).slice(-4)
	);
}

export type AssignDataIdOptions = { idProvider?: () => string };

/**
 * Gives every node that carries `data` a unique id before the editor exists.
 * The plugin below would otherwise do it on the first keystroke, rewriting
 * every node of a long document (and its DOM) inside that keystroke.
 */
export function assignMissingDataIds(
	content: JSONContent,
	schema: Schema,
	idProvider: () => string = defaultGenId,
): JSONContent {
	const seen = new Set<string>();
	const visit = (node: JSONContent): JSONContent => {
		const type = node.type ? schema.nodes[node.type] : undefined;
		let next = node;
		if (type?.spec.attrs && "data" in type.spec.attrs) {
			const data = node.attrs?.data ?? null;
			let id =
				data && typeof data.id === "string" && data.id.length > 0
					? (data.id as string)
					: null;
			if (id && seen.has(id)) id = null;
			if (!id) {
				do id = idProvider();
				while (seen.has(id));
				next = { ...node, attrs: { ...node.attrs, data: { ...data, id } } };
			}
			seen.add(id);
		}
		if (!next.content) return next;
		return { ...next, content: next.content.map(visit) };
	};
	return visit(content);
}

export function createAssignDataIdExtension(opts?: AssignDataIdOptions) {
	const idProvider = opts?.idProvider ?? defaultGenId;
	const supportsDataAttr = (node: any) =>
		Boolean(node?.type?.spec?.attrs && "data" in node.type.spec.attrs);
	const nextUniqueId = (seen: Set<string>) => {
		let next: string | null = null;
		while (!next || seen.has(next)) {
			next = idProvider();
		}
		return next;
	};
	// Documents known to hold a unique id on every node that takes one. Typing
	// text into such a document cannot break that, so the whole-document walk
	// below is skipped for it; on a long document that walk cost more than
	// the keystroke itself.
	const completeDocs = new WeakSet<ProseMirrorNode>();
	const onlyEditsText = (transactions: readonly Transaction[]) =>
		transactions.every((tr) =>
			tr.steps.every((step) => {
				if (step instanceof AddMarkStep || step instanceof RemoveMarkStep)
					return true;
				if (!(step instanceof ReplaceStep)) return false;
				// A split or paste brings nodes (and possibly copied ids) along.
				let bringsNodes = false;
				step.slice.content.descendants((node) => {
					if (supportsDataAttr(node)) bringsNodes = true;
					return !bringsNodes;
				});
				return !bringsNodes;
			}),
		);
	return Extension.create({
		name: "markdownWcAssignDataId",
		addProseMirrorPlugins() {
			return [
				new Plugin({
					props: {
						handleDOMEvents: {
							compositionstart: (view) => {
								if (!view.editable) return false;
								// Updating node markup after the browser starts composing
								// replaces its DOM target and can duplicate committed text.
								// Assign missing IDs before the native composition mutation.
								view.dispatch(
									view.state.tr
										.setMeta(assignIdsBeforeComposition, true)
										.setMeta("addToHistory", false),
								);
								return false;
							},
						},
					},
					appendTransaction: (
						_trs: readonly any[],
						oldState: any,
						newState: any,
					) => {
						const beforeComposition = _trs.some((tr) =>
							tr.getMeta(assignIdsBeforeComposition),
						);
						if (oldState.doc === newState.doc && !beforeComposition)
							return null;
						if (
							!beforeComposition &&
							completeDocs.has(oldState.doc) &&
							onlyEditsText(_trs)
						) {
							completeDocs.add(newState.doc);
							return null;
						}

						const tr = newState.tr;
						let modified = false;
						const seen = new Set<string>();

						newState.doc.descendants((node: any, pos: number) => {
							if (!supportsDataAttr(node)) return;
							const mappedPos = tr.mapping.map(pos);
							const currentNode = tr.doc.nodeAt(mappedPos);
							if (!currentNode || !supportsDataAttr(currentNode)) return;
							if (!currentNode.type.validContent(currentNode.content)) return;
							const attrs = currentNode.attrs || {};
							const data = attrs.data || null;
							let id: string | null =
								data && typeof data.id === "string" && data.id.length > 0
									? (data.id as string)
									: null;
							if (id && seen.has(id)) id = null;
							if (!id) {
								id = nextUniqueId(seen);
								const nextData = { ...(data || {}), id };
								const nextAttrs = { ...attrs, data: nextData };
								try {
									tr.setNodeMarkup(
										mappedPos,
										undefined,
										nextAttrs,
										currentNode.marks,
									);
								} catch {
									// Skip malformed/transient nodes instead of crashing the editor.
									return;
								}
								modified = true;
							}
							seen.add(id!);
						});

						// ID assignment only changes metadata. setNodeMarkup clears
						// stored marks, so restore the writing style from the edit.
						if (modified && newState.storedMarks) {
							tr.setStoredMarks(newState.storedMarks);
						}
						completeDocs.add(tr.doc);
						return modified ? tr : null;
					},
				}),
			];
		},
	});
}
