import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import type { Editor } from "@tiptap/core";
import { PanelTopDashed } from "lucide-react";

type DisclosurePosition = {
	readonly left: number;
	readonly top: number;
};

export function FrontmatterDisclosure({
	editor,
	surfaceRef,
}: {
	readonly editor: Editor;
	readonly surfaceRef: RefObject<HTMLDivElement | null>;
}) {
	const [position, setPosition] = useState<DisclosurePosition | null>(null);
	const [visible, setVisible] = useState(false);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const hideTimerRef = useRef<number | null>(null);
	const cancelHide = useCallback(() => {
		if (hideTimerRef.current === null) return;
		window.clearTimeout(hideTimerRef.current);
		hideTimerRef.current = null;
	}, []);
	const show = useCallback(() => {
		cancelHide();
		setVisible(true);
	}, [cancelHide]);
	const hideSoon = useCallback(() => {
		cancelHide();
		hideTimerRef.current = window.setTimeout(() => {
			const active = document.activeElement;
			if (buttonRef.current?.contains(active)) return;
			setVisible(false);
		}, 120);
	}, [cancelHide]);

	useEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) return;
		let cleanupTarget: (() => void) | null = null;
		let frame: number | null = null;
		const bindFirstBlock = () => {
			cleanupTarget?.();
			cleanupTarget = null;
			if (editor.state.doc.firstChild?.type.name === "markdownFrontmatter") {
				setPosition(null);
				setVisible(false);
				return;
			}

			const firstBlock = editor.view.dom.firstElementChild;
			if (!(firstBlock instanceof HTMLElement)) {
				setPosition(null);
				return;
			}
			const surfaceRect = surface.getBoundingClientRect();
			const blockRect = firstBlock.getBoundingClientRect();
			setPosition({
				left: blockRect.left - surfaceRect.left + surface.scrollLeft,
				top: blockRect.top - surfaceRect.top + surface.scrollTop - 34,
			});

			const handleFocusOut = () => {
				window.requestAnimationFrame(() => {
					const active = document.activeElement;
					if (
						firstBlock.contains(active) ||
						buttonRef.current?.contains(active)
					) {
						return;
					}
					hideSoon();
				});
			};
			const handleSurfacePointerMove = (event: PointerEvent) => {
				const currentSurfaceRect = surface.getBoundingClientRect();
				const currentBlockRect = firstBlock.getBoundingClientRect();
				if (
					event.clientY >= currentSurfaceRect.top &&
					event.clientY <= currentBlockRect.bottom
				) {
					show();
					return;
				}
				hideSoon();
			};
			const handleSurfacePointerLeave = () => hideSoon();
			firstBlock.addEventListener("pointerenter", show);
			firstBlock.addEventListener("focusin", show);
			firstBlock.addEventListener("focusout", handleFocusOut);
			surface.addEventListener("pointermove", handleSurfacePointerMove);
			surface.addEventListener("pointerleave", handleSurfacePointerLeave);
			cleanupTarget = () => {
				firstBlock.removeEventListener("pointerenter", show);
				firstBlock.removeEventListener("focusin", show);
				firstBlock.removeEventListener("focusout", handleFocusOut);
				surface.removeEventListener("pointermove", handleSurfacePointerMove);
				surface.removeEventListener("pointerleave", handleSurfacePointerLeave);
			};
		};
		const scheduleBind = () => {
			if (frame !== null) window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(() => {
				frame = null;
				bindFirstBlock();
			});
		};

		bindFirstBlock();
		editor.on("transaction", scheduleBind);
		window.addEventListener("resize", scheduleBind);
		return () => {
			cleanupTarget?.();
			editor.off("transaction", scheduleBind);
			window.removeEventListener("resize", scheduleBind);
			if (frame !== null) window.cancelAnimationFrame(frame);
			cancelHide();
		};
	}, [cancelHide, editor, hideSoon, show, surfaceRef]);

	if (!position) return null;

	return (
		<button
			ref={buttonRef}
			type="button"
			className="markdown-frontmatter-disclosure"
			data-visible={visible ? "true" : "false"}
			style={{ left: position.left, top: position.top }}
			onPointerEnter={show}
			onPointerLeave={hideSoon}
			onFocus={show}
			onBlur={hideSoon}
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => editor.commands.setFrontmatter()}
		>
			<PanelTopDashed aria-hidden />
			Add frontmatter
		</button>
	);
}
