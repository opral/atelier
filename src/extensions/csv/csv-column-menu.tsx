import { CsvOptionDetails } from "./csv-option-details";
import type { CsvOptionEdit } from "./csv-option-edit";
import {
	createContext,
	useContext,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
	type RefObject,
} from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
	ArrowLeftToLine,
	ArrowRightToLine,
	Check,
	ChevronRight,
	Pencil,
	GripVertical,
	Plus,
	SlidersHorizontal,
	ArrowLeftRight,
	Trash2,
	WrapText,
} from "lucide-react";
import { CSV_COLORS, CSV_TYPES, CsvPill, optionColor } from "./csv-properties";
import type { CsvColumnInfo } from "./csv-metadata";

/** Radix flips submenus; when neither side fits, keep the panel reachable by overlapping its parent. */
function useMenuViewportClamp() {
	const [node, setNode] = useState<HTMLDivElement | null>(null);
	const ref = useCallback(
		(element: HTMLDivElement | null) => setNode(element),
		[],
	);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const offsetRef = useRef(offset);
	offsetRef.current = offset;
	useLayoutEffect(() => {
		if (!node) return;
		const update = () => {
			const box = node.getBoundingClientRect(),
				old = offsetRef.current;
			if (!box.width || !box.height) return;
			const rawX = box.x - old.x,
				rawY = box.y - old.y;
			const x =
				Math.max(8, Math.min(rawX, window.innerWidth - box.width - 8)) - rawX;
			const y =
				Math.max(8, Math.min(rawY, window.innerHeight - box.height - 8)) - rawY;
			if (Math.abs(x - old.x) > 0.5 || Math.abs(y - old.y) > 0.5) {
				setOffset({ x, y });
			}
		};
		update();
		const resize = new ResizeObserver(update);
		resize.observe(node);
		const position = new MutationObserver(update);
		if (node.parentElement)
			position.observe(node.parentElement, {
				attributes: true,
				attributeFilter: ["style"],
			});
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			resize.disconnect();
			position.disconnect();
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [node]);
	return { ref, style: { translate: `${offset.x}px ${offset.y}px` } };
}

const SubmenuContext = createContext<{
	close: () => void;
	trigger: RefObject<HTMLDivElement | null>;
} | null>(null);
function CsvSub({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLDivElement>(null);
	const context = useMemo(() => ({ close: () => setOpen(false), trigger }), []);
	return (
		<SubmenuContext.Provider value={context}>
			<Menu.Sub open={open} onOpenChange={setOpen}>
				{children}
			</Menu.Sub>
		</SubmenuContext.Provider>
	);
}
function CsvSubTrigger(props: ComponentProps<typeof Menu.SubTrigger>) {
	const context = useContext(SubmenuContext)!;
	return <Menu.SubTrigger {...props} ref={context.trigger} />;
}
function CsvSubContent(props: ComponentProps<typeof Menu.SubContent>) {
	const clamped = useMenuViewportClamp();
	const context = useContext(SubmenuContext)!;
	return (
		<Menu.SubContent
			{...props}
			{...clamped}
			onFocusOutside={(event) => {
				// Crossing an overlapping pane briefly focuses the parent menu itself.
				// Keep the submenu open until focus reaches another actionable item.
				if ((event.target as HTMLElement)?.getAttribute("role") === "menu")
					event.preventDefault();
			}}
			onEscapeKeyDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
				context.close();
				requestAnimationFrame(() => context.trigger.current?.focus());
			}}
		/>
	);
}

/** Radix owns submenu focus, pointer grace areas, dismissal, and collision handling. */
export function CsvColumnMenu({
	x,
	y,
	title,
	info,
	onRename,
	optionValues,
	onEditOption,
	onChange,
	onClose,
	onPointerDownOutside,
	onInsertLeft,
	onInsertRight,
	onDelete,
	wrapped = false,
	onToggleWrap,
}: {
	x: number;
	y: number;
	title: string;
	info: CsvColumnInfo;
	optionValues: readonly string[];
	onEditOption: (edit: CsvOptionEdit) => void;
	onRename: (name: string) => void;
	onChange: (patch: Partial<CsvColumnInfo>) => void;
	onClose: () => void;
	/** An outside press that is about to close the menu, before it closes. */
	onPointerDownOutside?: (event: { clientX: number; clientY: number }) => void;
	onInsertLeft: () => void;
	onInsertRight: () => void;
	onDelete: () => void;
	wrapped?: boolean;
	onToggleWrap?: () => void;
}) {
	const [name, setName] = useState(title);
	const draggedOption = useRef<string | null>(null);
	const [dropEdge, setDropEdge] = useState<{
		value: string;
		edge: "top" | "bottom";
	} | null>(null);
	const clamped = useMenuViewportClamp();
	const inputRef = useRef<HTMLInputElement>(null);
	const opening = useRef(true);
	const interacted = useRef(false);
	useEffect(() => {
		// Glide schedules canvas focus on header selection; let it finish before
		// focusing the menu, without treating that initial focus as dismissal.
		let inner = 0;
		const frame = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				if (!interacted.current) {
					inputRef.current?.closest<HTMLElement>('[role="menu"]')?.focus();
				}
				opening.current = false;
			});
		});
		return () => {
			cancelAnimationFrame(frame);
			cancelAnimationFrame(inner);
		};
	}, []);
	const committed = useRef(title);
	const cancelled = useRef(false);
	const current = CSV_TYPES.find((t) => t.type === info.type) ?? CSV_TYPES[0];
	const commit = () => {
		if (cancelled.current) return;
		const next = name.trim();
		if (!next) {
			setName(committed.current);
			return;
		}
		if (next !== committed.current) {
			committed.current = next;
			onRename(next);
		}
	};
	// The menu unmounts on an outside press before the field blurs; a typed
	// name still commits (Escape marks it cancelled first).
	const commitRef = useRef(commit);
	commitRef.current = commit;
	useEffect(() => () => commitRef.current(), []);
	return (
		<Menu.Root
			open
			modal={false}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Menu.Trigger
				tabIndex={-1}
				aria-hidden="true"
				style={{
					position: "fixed",
					left: x,
					top: y,
					width: 0,
					height: 0,
					padding: 0,
					border: 0,
					pointerEvents: "none",
				}}
			/>
			<Menu.Portal>
				<Menu.Content
					{...clamped}
					className="csv-column-menu"
					onPointerMove={() => {
						interacted.current = true;
					}}
					onPointerDownCapture={() => {
						interacted.current = true;
					}}
					onClickCapture={() => {
						interacted.current = true;
					}}
					onKeyDownCapture={() => {
						interacted.current = true;
					}}
					onPointerDownOutside={(event) => {
						const original = event.detail.originalEvent;
						if (original instanceof MouseEvent)
							onPointerDownOutside?.(original);
					}}
					side="bottom"
					align="start"
					sideOffset={0}
					collisionPadding={8}
					aria-label="Column settings"
					onCloseAutoFocus={(e) => e.preventDefault()}
					onFocusOutside={(e) => {
						if (opening.current) e.preventDefault();
					}}
					onEscapeKeyDown={() => {
						cancelled.current = true;
						setName(committed.current);
					}}
				>
					<div className="csv-column-name">
						<current.icon size={17} aria-hidden="true" />
						<input
							ref={inputRef}
							aria-label="Column name"
							value={name}
							onChange={(e) => {
								cancelled.current = false;
								setName(e.target.value);
							}}
							onBlur={commit}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter") {
									e.preventDefault();
									commit();
									onClose();
								}
								if (e.key === "Escape") {
									e.preventDefault();
									cancelled.current = true;
									setName(committed.current);
									onClose();
								}
								if (e.key === "ArrowDown") {
									e.preventDefault();
									commit();
									(
										e.currentTarget
											.closest('[role="menu"]')
											?.querySelector('[role="menuitem"]') as HTMLElement | null
									)?.focus();
								}
							}}
						/>
					</div>
					{info.type === "select" && (
						<CsvSub>
							<CsvSubTrigger className="csv-column-action">
								<SlidersHorizontal size={16} />
								<span>Edit property</span>
								<ChevronRight size={14} className="csv-submenu-chevron" />
							</CsvSubTrigger>
							<Menu.Portal>
								<CsvSubContent
									className="csv-column-menu csv-column-submenu csv-options-menu"
									sideOffset={4}
									alignOffset={-4}
									collisionPadding={8}
									aria-label="Edit property"
								>
									{(info.options ?? []).map((option) => (
										<CsvSub key={option.value}>
											<CsvSubTrigger
												className="csv-column-action csv-option-edit"
												aria-label={`Edit option ${option.value}`}
												draggable
												title="Drag to reorder, or open to edit"
												data-drop-edge={
													dropEdge?.value === option.value
														? dropEdge.edge
														: undefined
												}
												onDragStart={(event) => {
													draggedOption.current = option.value;
													event.dataTransfer.effectAllowed = "move";
													event.dataTransfer.setData(
														"text/plain",
														option.value,
													);
												}}
												onDragEnd={() => {
													draggedOption.current = null;
													setDropEdge(null);
												}}
												onDragOver={(event) => {
													if (draggedOption.current === null) return;
													event.preventDefault();
													event.dataTransfer.dropEffect = "move";
													const bounds =
														event.currentTarget.getBoundingClientRect();
													setDropEdge({
														value: option.value,
														edge:
															event.clientY < bounds.y + bounds.height / 2
																? "top"
																: "bottom",
													});
												}}
												onDrop={(event) => {
													event.preventDefault();
													const value = draggedOption.current;
													if (value === null) return;
													const options = info.options ?? [];
													const index = options.findIndex(
														(item) => item.value === option.value,
													);
													const bounds =
														event.currentTarget.getBoundingClientRect();
													const before =
														event.clientY < bounds.y + bounds.height / 2
															? option.value
															: (options[index + 1]?.value ?? null);
													if (value !== option.value)
														onEditOption({ kind: "move", value, before });
													draggedOption.current = null;
													setDropEdge(null);
												}}
											>
												<GripVertical
													size={13}
													className="csv-option-grip"
													aria-hidden="true"
												/>
												<CsvPill {...option} />
												<Pencil
													size={14}
													className="csv-option-pencil"
													aria-hidden="true"
												/>
											</CsvSubTrigger>
											<Menu.Portal>
												<CsvSubContent
													className="csv-column-menu csv-option-details"
													sideOffset={4}
													alignOffset={-4}
													collisionPadding={8}
													aria-label={`Edit option ${option.value}`}
												>
													<CsvOptionDetails
														value={option.value}
														options={(info.options ?? []).map(
															(item) => item.value,
														)}
														existingValues={optionValues}
														used={
															optionValues.filter(
																(value) => value === option.value,
															).length
														}
														onEdit={onEditOption}
													>
														<Menu.RadioGroup
															value={option.color}
															className="csv-color-swatches"
															onValueChange={(color) =>
																onChange({
																	options: info.options!.map((o) =>
																		o.value === option.value
																			? { ...o, color }
																			: o,
																	),
																})
															}
															aria-label={`Color for ${option.value}`}
														>
															{Object.keys(CSV_COLORS).map((color) => {
																const [background, foreground] =
																	optionColor(color);
																return (
																	<Menu.RadioItem
																		key={color}
																		value={color}
																		className="csv-color-swatch"
																		aria-label={
																			color[0]!.toUpperCase() + color.slice(1)
																		}
																		title={
																			color[0]!.toUpperCase() + color.slice(1)
																		}
																		style={{ background, color: foreground }}
																		onSelect={(e) => e.preventDefault()}
																	>
																		<Menu.ItemIndicator>
																			<Check size={17} />
																		</Menu.ItemIndicator>
																	</Menu.RadioItem>
																);
															})}
														</Menu.RadioGroup>
													</CsvOptionDetails>
												</CsvSubContent>
											</Menu.Portal>
										</CsvSub>
									))}
									<Menu.Separator className="csv-column-separator" />
									<form
										className="csv-add-option-form"
										onSubmit={(e) => {
											e.preventDefault();
											const input = e.currentTarget.elements.namedItem(
												"option",
											) as HTMLInputElement;
											const value = input.value.trim();
											if (
												value &&
												!info.options?.some((o) => o.value === value)
											) {
												onChange({
													options: [
														...(info.options ?? []),
														{ value, color: "gray" },
													],
												});
												input.value = "";
											}
										}}
									>
										<Plus size={15} aria-hidden="true" />
										<input
											name="option"
											aria-label="New option"
											placeholder="Add an option…"
											onKeyDown={(e) => {
												if (e.key !== "Escape") e.stopPropagation();
											}}
										/>
										<button type="submit" aria-label="Create option">
											<Plus size={14} />
										</button>
									</form>
								</CsvSubContent>
							</Menu.Portal>
						</CsvSub>
					)}
					<CsvSub>
						<CsvSubTrigger className="csv-column-action">
							<ArrowLeftRight size={16} />
							<span>Change type</span>
							<span className="csv-current-type">{current.label}</span>
							<ChevronRight size={14} />
						</CsvSubTrigger>
						<Menu.Portal>
							<CsvSubContent
								className="csv-column-menu csv-column-submenu"
								sideOffset={4}
								alignOffset={-4}
								collisionPadding={8}
								aria-label="Column types"
							>
								<Menu.RadioGroup
									value={info.type}
									onValueChange={(type) =>
										onChange({ type: type as CsvColumnInfo["type"] })
									}
								>
									{CSV_TYPES.map((type) => (
										<Menu.RadioItem
											key={type.type}
											value={type.type}
											className="csv-column-action"
											onSelect={(e) => e.preventDefault()}
										>
											<type.icon size={16} />
											<span>{type.label}</span>
											<Menu.ItemIndicator className="csv-submenu-chevron">
												<Check size={14} />
											</Menu.ItemIndicator>
										</Menu.RadioItem>
									))}
								</Menu.RadioGroup>
							</CsvSubContent>
						</Menu.Portal>
					</CsvSub>
					<Menu.Separator className="csv-column-separator" />
					{info.type === "text" && onToggleWrap && (
						<>
							<Menu.Item className="csv-column-action" onSelect={onToggleWrap}>
								{wrapped ? (
									<ArrowRightToLine size={16} />
								) : (
									<WrapText size={16} />
								)}
								<span>{wrapped ? "Unwrap content" : "Wrap content"}</span>
							</Menu.Item>
							<Menu.Separator className="csv-column-separator" />
						</>
					)}
					<Menu.Item className="csv-column-action" onSelect={onInsertLeft}>
						<ArrowLeftToLine size={16} />
						<span>Insert column left</span>
					</Menu.Item>
					<Menu.Item className="csv-column-action" onSelect={onInsertRight}>
						<ArrowRightToLine size={16} />
						<span>Insert column right</span>
					</Menu.Item>
					<Menu.Item
						className="csv-column-action csv-column-destructive"
						onSelect={onDelete}
					>
						<Trash2 size={16} />
						<span>Delete column</span>
					</Menu.Item>
				</Menu.Content>
			</Menu.Portal>
		</Menu.Root>
	);
}
