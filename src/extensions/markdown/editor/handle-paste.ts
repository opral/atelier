import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import type { StoredPastedMarkdownImage } from "./store-pasted-image";
import { closeHistory } from "@tiptap/pm/history";

export type MarkdownImagePasteStatus =
	| { readonly state: "saving" }
	| {
			readonly state: "saved";
			readonly markdownSrc: string;
			readonly workspacePath: string;
	  }
	| { readonly state: "canceled" }
	| { readonly state: "error"; readonly message: string };

export type StorePastedImage = (args: {
	readonly file: File;
	readonly mimeType: string;
}) => Promise<StoredPastedMarkdownImage>;

type PasteTarget = {
	readonly from: number;
	readonly to: number;
	readonly inlineFrom: boolean;
	readonly inlineTo: boolean;
	readonly sameParent: boolean;
};

type PasteTargetTracker = {
	readonly current: () => PasteTarget | null;
	readonly stop: () => void;
};

type PendingImagePaste = {
	canceled: boolean;
	readonly tracker: PasteTargetTracker;
	readonly notify?: (status: MarkdownImagePasteStatus) => void;
};

const imagePasteQueues = new WeakMap<object, Promise<void>>();
const pendingImagePastes = new WeakMap<object, PendingImagePaste[]>();
const IMAGE_PASTE_TRANSACTION_META = "atelier.markdown-image-paste";

/** Cancels the newest paste that has not yet become a document edit. */
export function cancelPendingImagePaste(editor: object): boolean {
	const pending = pendingImagePastes.get(editor);
	if (!pending) return false;
	for (let index = pending.length - 1; index >= 0; index -= 1) {
		const imagePaste = pending[index];
		if (!imagePaste || imagePaste.canceled) continue;
		imagePaste.canceled = true;
		imagePaste.tracker.stop();
		notifyImagePasteStatus(imagePaste.notify, { state: "canceled" });
		return true;
	}
	return false;
}

/**
 * Owns Markdown and image clipboard payloads for the TipTap editor.
 *
 * ProseMirror requires paste handlers to return a synchronous boolean. Image
 * persistence continues asynchronously after this function has claimed the
 * event, while ordinary Markdown text insertion remains synchronous.
 */
export function handlePaste(args: {
	editor: any;
	event: ClipboardEvent | any;
	storeImage?: StorePastedImage;
	onImagePasteStatus?: (status: MarkdownImagePasteStatus) => void;
}): boolean {
	const { editor, event, storeImage, onImagePasteStatus } = args;
	if (editor?.isDestroyed === true || editor?.isEditable === false)
		return false;

	const clipboardImage = firstClipboardImage(event);
	if (clipboardImage) {
		event.preventDefault?.();
		if (!storeImage) {
			notifyImagePasteStatus(onImagePasteStatus, {
				state: "error",
				message: "This document cannot store workspace assets.",
			});
			return true;
		}

		// Capture this paste's location before it joins the per-editor queue. A
		// later paste may wait on an earlier image write while the user keeps
		// moving and editing elsewhere.
		const pasteTargetTracker = trackPasteTarget(editor);
		const pendingImagePaste = registerPendingImagePaste(editor, {
			canceled: false,
			tracker: pasteTargetTracker,
			notify: onImagePasteStatus,
		});
		enqueueImagePaste(editor, async () => {
			let storedImage: StoredPastedMarkdownImage | null = null;
			try {
				// A queued paste can outlive its editor when the user navigates or a
				// review locks the document. Do not create a write that would only be
				// cleaned up immediately afterward.
				if (
					pendingImagePaste.canceled ||
					editor?.isDestroyed === true ||
					editor?.isEditable === false
				) {
					return;
				}
				notifyImagePasteStatus(onImagePasteStatus, { state: "saving" });
				storedImage = await storeImage(clipboardImage);
				if (pendingImagePaste.canceled) {
					await storedImage.remove();
					storedImage = null;
					return;
				}
				if (editor?.isDestroyed === true || editor?.isEditable === false) {
					throw new Error("The editor is no longer editable.");
				}
				const pasteTarget = pasteTargetTracker.current();
				pasteTargetTracker.stop();
				const inserted = insertPastedBlocks(
					editor,
					[
						{
							type: "imageBlock",
							attrs: {
								src: storedImage.markdownSrc,
								alt: storedImage.alt,
								title: null,
								data: null,
								imageData: null,
							},
						},
					],
					pasteTarget,
					{ preserveLiveSelection: true },
				);
				if (!inserted) {
					throw new Error("The image reference could not be inserted.");
				}
				notifyImagePasteStatus(onImagePasteStatus, {
					state: "saved",
					markdownSrc: storedImage.markdownSrc,
					workspacePath: storedImage.workspacePath,
				});
			} catch (error) {
				if (storedImage) {
					try {
						await storedImage.remove();
					} catch {
						// The reference was never inserted, so cleanup is best-effort.
					}
				}
				if (!pendingImagePaste.canceled) {
					notifyImagePasteStatus(onImagePasteStatus, {
						state: "error",
						message: imagePasteErrorMessage(error),
					});
				}
			} finally {
				pasteTargetTracker.stop();
				finishPendingImagePaste(editor, pendingImagePaste);
			}
		});
		return true;
	}

	const text = event?.clipboardData?.getData?.("text/plain") ?? "";
	if (!text) return false;

	event.preventDefault?.();
	const ast = parseMarkdown(text);
	const tiptapDoc = astToTiptapDoc(ast) as any;
	return insertPastedBlocks(editor, tiptapDoc?.content ?? []);
}

function insertPastedBlocks(
	editor: any,
	blockFragment: any[],
	preferredTarget?: PasteTarget | null,
	options?: { readonly preserveLiveSelection?: boolean },
): boolean {
	if (!editor?.state?.selection || !editor.commands?.insertContentAt) {
		return false;
	}
	const currentTarget = capturePasteTarget(editor);
	const preferredTargetIsValid =
		preferredTarget &&
		preferredTarget.from >= 0 &&
		preferredTarget.to >= preferredTarget.from &&
		preferredTarget.to <= editor.state.doc.content.size;
	const target = preferredTargetIsValid
		? resolvePasteTarget(editor, preferredTarget.from, preferredTarget.to)
		: currentTarget;
	if (!target) return false;

	const { from, to, inlineFrom, inlineTo, sameParent } = target;
	if (from !== to) {
		// A single paragraph can replace an inline selection without changing
		// the surrounding block. Multi-block Markdown must stay as blocks or
		// all content after the first paragraph would be discarded.
		if (inlineFrom && inlineTo && sameParent) {
			const first = Array.isArray(blockFragment) ? blockFragment[0] : null;
			const isSingleParagraph =
				blockFragment.length === 1 &&
				first &&
				first.type === "paragraph" &&
				Array.isArray(first.content);
			if (isSingleParagraph) {
				return insertContentAt(
					editor,
					{ from, to } as any,
					first.content,
					options?.preserveLiveSelection,
				);
			}
		}
		return insertContentAt(
			editor,
			{ from, to } as any,
			blockFragment,
			options?.preserveLiveSelection,
		);
	}

	return insertContentAt(
		editor,
		from as any,
		blockFragment,
		options?.preserveLiveSelection,
	);
}

function insertContentAt(
	editor: any,
	position: any,
	content: any,
	preserveLiveSelection = false,
): boolean {
	const commandOptions = preserveLiveSelection
		? { updateSelection: false }
		: undefined;
	if (!preserveLiveSelection || !editor?.chain) {
		return editor.commands.insertContentAt(position, content, commandOptions);
	}
	const inserted = editor
		.chain()
		.command(({ tr }: { tr: any }) => {
			closeHistory(tr);
			tr.setMeta(IMAGE_PASTE_TRANSACTION_META, true);
			return true;
		})
		.insertContentAt(position, content, commandOptions)
		.run();
	if (inserted && editor?.view?.dispatch && editor?.state?.tr) {
		// Keep subsequent typing out of the image's undo event as well.
		editor.view.dispatch(closeHistory(editor.state.tr));
	}
	return inserted;
}

function capturePasteTarget(editor: any): PasteTarget | null {
	const selection = editor?.state?.selection;
	if (!selection) return null;
	return resolvePasteTarget(editor, selection.from, selection.to);
}

function resolvePasteTarget(
	editor: any,
	from: number,
	to: number,
): PasteTarget | null {
	const doc = editor?.state?.doc;
	if (!doc?.resolve) return null;
	const $from = doc.resolve(from);
	const $to = doc.resolve(to);
	return {
		from,
		to,
		inlineFrom: Boolean($from?.parent?.inlineContent),
		inlineTo: Boolean($to?.parent?.inlineContent),
		sameParent: Boolean($from?.sameParent?.($to)),
	};
}

function trackPasteTarget(editor: any): PasteTargetTracker {
	let target = capturePasteTarget(editor);
	let stopped = false;
	const handleTransaction = ({ transaction }: { transaction?: any }) => {
		if (!target || !transaction?.mapping) return;
		const isCollapsed = target.from === target.to;
		// Later image pastes at the same collapsed cursor belong after earlier
		// queued images, while ordinary typing after a paste event stays after the
		// pending image. Tagging our insertion transaction lets both feel natural.
		if (isCollapsed && transaction.getMeta?.(IMAGE_PASTE_TRANSACTION_META)) {
			const position = mapCollapsedTargetAfterImage(
				transaction.mapping,
				target.from,
			);
			target = { ...target, from: position, to: position };
			return;
		}
		const fromResult = transaction.mapping.mapResult(target.from, -1);
		const toResult = transaction.mapping.mapResult(
			target.to,
			isCollapsed ? -1 : 1,
		);
		const selectedContentWasReplaced =
			!isCollapsed &&
			Boolean(
				fromResult.deleted ||
				fromResult.deletedAcross ||
				fromResult.deletedAfter ||
				toResult.deleted ||
				toResult.deletedAcross ||
				toResult.deletedBefore,
			);
		const mappedFrom = selectedContentWasReplaced
			? transaction.mapping.map(target.to, 1)
			: fromResult.pos;
		const mappedTo = selectedContentWasReplaced ? mappedFrom : toResult.pos;
		target = {
			...target,
			// Keep later typing after a collapsed paste anchor. An untouched range
			// continues to identify the original selection; if another transaction
			// replaces that selection first, collapse rather than deleting the new
			// user input when the image arrives.
			from: mappedFrom,
			to: mappedTo,
		};
	};
	editor?.on?.("transaction", handleTransaction);
	return {
		current: () => target,
		stop: () => {
			if (stopped) return;
			stopped = true;
			editor?.off?.("transaction", handleTransaction);
		},
	};
}

function mapCollapsedTargetAfterImage(mapping: any, position: number): number {
	let mappedPosition = position;
	for (const stepMap of mapping.maps ?? []) {
		let replacementEnd: number | null = null;
		stepMap.forEach?.(
			(oldStart: number, oldEnd: number, _newStart: number, newEnd: number) => {
				if (mappedPosition >= oldStart && mappedPosition <= oldEnd) {
					replacementEnd = newEnd;
				}
			},
		);
		mappedPosition = replacementEnd ?? stepMap.map(mappedPosition, 1);
	}
	return mappedPosition;
}

function firstClipboardImage(
	event: ClipboardEvent | any,
): { file: File; mimeType: string } | null {
	const clipboardData = event?.clipboardData;
	for (const item of arrayFromList<any>(clipboardData?.items)) {
		const mimeType = String(item?.type ?? "").toLowerCase();
		if (item?.kind !== "file" || !mimeType.startsWith("image/")) continue;
		const file = item.getAsFile?.();
		if (file) return { file, mimeType: mimeType || file.type };
	}
	for (const file of arrayFromList<File>(clipboardData?.files)) {
		const mimeType = String(file?.type ?? "").toLowerCase();
		if (mimeType.startsWith("image/")) return { file, mimeType };
	}
	return null;
}

function arrayFromList<T>(
	value: ArrayLike<T> | Iterable<T> | null | undefined,
) {
	if (!value) return [];
	return Array.from(value);
}

function enqueueImagePaste(editor: object, task: () => Promise<void>): void {
	const previous = imagePasteQueues.get(editor);
	const next = (previous ? previous.then(task, task) : task()).catch(() => {
		// Individual paste tasks report their own failures. Keep the queue
		// resolved so a surprising callback/editor exception cannot create an
		// unhandled rejection or block later pastes.
	});
	imagePasteQueues.set(editor, next);
	void next.finally(() => {
		if (imagePasteQueues.get(editor) === next) {
			imagePasteQueues.delete(editor);
		}
	});
}

function registerPendingImagePaste(
	editor: object,
	pendingImagePaste: PendingImagePaste,
): PendingImagePaste {
	const pending = pendingImagePastes.get(editor) ?? [];
	pending.push(pendingImagePaste);
	pendingImagePastes.set(editor, pending);
	return pendingImagePaste;
}

function finishPendingImagePaste(
	editor: object,
	pendingImagePaste: PendingImagePaste,
): void {
	const pending = pendingImagePastes.get(editor);
	if (!pending) return;
	const index = pending.indexOf(pendingImagePaste);
	if (index >= 0) pending.splice(index, 1);
	if (pending.length === 0) pendingImagePastes.delete(editor);
}

function notifyImagePasteStatus(
	notify: ((status: MarkdownImagePasteStatus) => void) | undefined,
	status: MarkdownImagePasteStatus,
): void {
	try {
		notify?.(status);
	} catch {
		// Product feedback must never break the paste operation itself.
	}
}

function imagePasteErrorMessage(error: unknown): string {
	if (
		error instanceof Error &&
		error.name === "PastedMarkdownImageError" &&
		error.message
	) {
		return error.message;
	}
	return "Nothing was added. Try again.";
}
