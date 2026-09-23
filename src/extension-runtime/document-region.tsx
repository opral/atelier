import {
	createContext,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

/**
 * The document region of a view's frame.
 *
 * A frame is rendered from props that are always there — toolbar, gutters,
 * background — and only its document region may wait. The region holds two
 * documents at most: the one on screen and, while a reader is handing the
 * frame the next one, that one laid out over it out of sight. Headless
 * readers under the frame hand documents in with `useShownDocument`; a
 * document says its content is ready with `useDocumentReady`, and only then does
 * it replace the one on screen. Nothing in the region ever paints blank
 * between two documents, and a document that must not be seen before it is
 * complete — a file stepped to inside a review — is never seen before then.
 */
export type DocumentSlot = {
	readonly key: string;
	readonly element: ReactNode;
};

export type DocumentRegionHandle = {
	/**
	 * Hand a document to the region. The document already on screen, named
	 * by the same key, is updated in place; another document is mounted out
	 * of sight until its content is ready, and only then replaces the one on
	 * screen.
	 */
	readonly show: (key: string, element: ReactNode) => void;
	/** The document named by `key` has prepared its content for display. */
	readonly ready: (key: string) => void;
};

export type DocumentRegionState = {
	readonly shown: DocumentSlot | null;
	readonly next: DocumentSlot | null;
};

const DocumentRegionContext = createContext<DocumentRegionHandle | null>(null);

type DocumentSlotHandle = {
	readonly key: string;
	readonly hidden: boolean;
	readonly ready: () => void;
};

const DocumentSlotContext = createContext<DocumentSlotHandle | null>(null);

/** The region's two slots and the handle readers and documents talk to. */
export function useDocumentRegion(): DocumentRegionState & {
	readonly handle: DocumentRegionHandle;
} {
	const [slots, setSlots] = useState<DocumentRegionState>({
		shown: null,
		next: null,
	});
	const handle = useMemo<DocumentRegionHandle>(
		() => ({
			show: (key, element) => {
				setSlots((current) => {
					if (current.shown?.key === key) {
						return {
							shown: { key, element },
							next: current.next?.key === key ? null : current.next,
						};
					}
					return { shown: current.shown, next: { key, element } };
				});
			},
			ready: (key) => {
				setSlots((current) =>
					current.next?.key === key
						? { shown: current.next, next: null }
						: current,
				);
			},
		}),
		[],
	);
	return { ...slots, handle };
}

export function DocumentRegionProvider({
	handle,
	children,
}: {
	readonly handle: DocumentRegionHandle;
	readonly children: ReactNode;
}) {
	return (
		<DocumentRegionContext.Provider value={handle}>
			{children}
		</DocumentRegionContext.Provider>
	);
}

/**
 * The region's documents. The one on screen fills the region; the next one
 * is laid out over it, invisible, until it is ready. A slot keeps its
 * identity — and its document's editor — across that promotion.
 */
export function DocumentSlots({
	shown,
	next,
	handle,
	attribute,
}: DocumentRegionState & {
	readonly handle: DocumentRegionHandle;
	/** The data attribute a slot names its document with. */
	readonly attribute: string;
}) {
	return (
		<>
			{[
				shown ? (
					<DocumentSlotView
						key={shown.key}
						slotKey={shown.key}
						hidden={false}
						attribute={attribute}
						onReady={handle.ready}
					>
						{shown.element}
					</DocumentSlotView>
				) : null,
				next ? (
					<DocumentSlotView
						key={next.key}
						slotKey={next.key}
						hidden
						attribute={attribute}
						onReady={handle.ready}
					>
						{next.element}
					</DocumentSlotView>
				) : null,
			]}
		</>
	);
}

function DocumentSlotView({
	slotKey,
	hidden,
	attribute,
	onReady,
	children,
}: {
	readonly slotKey: string;
	readonly hidden: boolean;
	readonly attribute: string;
	readonly onReady: (key: string) => void;
	readonly children: ReactNode;
}) {
	const slot = useMemo<DocumentSlotHandle>(
		() => ({ key: slotKey, hidden, ready: () => onReady(slotKey) }),
		[hidden, onReady, slotKey],
	);
	return (
		<div
			// Both slots keep the same viewport geometry throughout a hand-off.
			// Only visibility changes when a prepared document is promoted. If the
			// shown slot returns to normal flow here, `h-full` depends on an
			// indirect/auto height and can collapse the editor after a review step.
			className={`absolute inset-0 flex min-h-0 flex-col ${
				hidden ? "invisible pointer-events-none" : "visible"
			}`}
			aria-hidden={hidden || undefined}
			{...{ [attribute]: slotKey }}
		>
			<DocumentSlotContext.Provider value={slot}>
				{children}
			</DocumentSlotContext.Provider>
		</div>
	);
}

/**
 * Hands a document to the region as soon as it is known, before the browser
 * paints. `null` hands over nothing: the region keeps what it shows.
 */
export function useShownDocument(key: string, element: ReactNode) {
	const region = useContext(DocumentRegionContext);
	if (!region) throw new Error("A document renders inside its view's frame.");
	useLayoutEffect(() => {
		if (element === null) return;
		region.show(key, element);
	}, [region, key, element]);
}

/** A headless reader's hand-over, for where a hook cannot be called. */
export function HandDocument({
	documentKey,
	element,
}: {
	readonly documentKey: string;
	readonly element: ReactNode;
}) {
	useShownDocument(documentKey, element);
	return null;
}

/** Tells the region that this document's content is ready to be shown. */
export function useDocumentReady(ready: boolean) {
	const slot = useContext(DocumentSlotContext);
	if (!slot) throw new Error("A document renders inside a document slot.");
	useLayoutEffect(() => {
		if (ready) slot.ready();
	}, [ready, slot]);
}

/** Whether this document is the region's next one, laid out out of sight. */
export function useDocumentHidden(): boolean {
	return useContext(DocumentSlotContext)?.hidden ?? false;
}
