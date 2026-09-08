import { useLayoutEffect, useRef, type RefObject } from "react";
import {
	autocompletion,
	acceptCompletion,
	closeCompletion,
	completionKeymap,
	snippet,
} from "@codemirror/autocomplete";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import {
	Compartment,
	EditorState,
	Prec,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	EditorView,
	keymap,
	lineNumbers,
	showTooltip,
	tooltips,
	type Tooltip,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Schema, TableFunction } from "./schema";
import {
	activeFunction,
	createSqlCompletion,
	functionTemplate,
} from "./sql-completion";

export type SqlEditorHandle = {
	insertFunction: (fn: TableFunction) => void;
	focus: () => void;
};

const focusEffect = StateEffect.define<boolean>();
const editorFocused = StateField.define<boolean>({
	create: () => false,
	update: (value, transaction) => {
		for (const effect of transaction.effects)
			if (effect.is(focusEffect)) return effect.value;
		return value;
	},
});

const highlight = HighlightStyle.define([
	{
		tag: tags.keyword,
		color: "var(--color-syntax-keyword)",
		fontWeight: "600",
	},
	{ tag: tags.string, color: "var(--color-syntax-string)" },
	{ tag: tags.number, color: "var(--color-syntax-number)" },
	{ tag: tags.comment, color: "var(--color-text-tertiary)" },
]);

function extensionsForSchema(schema: Schema | null) {
	return [
		autocompletion({
			override: [createSqlCompletion(schema)],
			defaultKeymap: false,
			icons: false,
			maxRenderedOptions: 30,
			tooltipClass: () => "atelier-sql-completion",
		}),
		showTooltip.compute([editorFocused, "selection", "doc"], (state) => {
			if (!state.field(editorFocused)) return null;
			const call = activeFunction(
				state.doc.toString(),
				state.selection.main.head,
				schema,
			);
			if (!call) return null;
			return {
				pos: state.selection.main.head,
				above: true,
				strictSide: true,
				create: () => {
					const dom = document.createElement("div");
					dom.className = "atelier-sql-argument-hint";
					const overloads = call.fn.signature.split("|").map((s) => s.trim());
					const signature =
						overloads.find(
							(s) =>
								s.slice(1, -1).split(",").filter(Boolean).length >
								call.argument,
						) ?? overloads.at(-1)!;
					dom.append(`${call.fn.name}(`);
					signature
						.slice(1, -1)
						.split(",")
						.forEach((arg, i) => {
							if (i) dom.append(", ");
							const span = document.createElement(
								i === call.argument ? "strong" : "span",
							);
							span.textContent = arg.trim();
							dom.append(span);
						});
					dom.append(")");
					return { dom };
				},
			} satisfies Tooltip;
		}),
	];
}

export function SqlEditor({
	query,
	onQueryChange,
	onRun,
	schema = null,
	handle: externalHandle,
}: {
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly onRun: () => void;
	readonly schema?: Schema | null;
	readonly handle?: RefObject<SqlEditorHandle | null>;
}) {
	const internalHandle = useRef<SqlEditorHandle | null>(null);
	const handle = externalHandle ?? internalHandle;
	const parent = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const callbacks = useRef({ onQueryChange, onRun });
	const configuration = useRef(new Compartment());
	useLayoutEffect(() => {
		callbacks.current = { onQueryChange, onRun };
	});
	useLayoutEffect(() => {
		const element = parent.current!;
		const view = new EditorView({
			parent: element,
			state: EditorState.create({
				doc: query,
				extensions: [
					sql({ dialect: PostgreSQL }),
					syntaxHighlighting(highlight),
					lineNumbers(),
					history(),
					editorFocused,
					EditorView.focusChangeEffect.of((_state, focused) =>
						focusEffect.of(focused),
					),
					configuration.current.of(extensionsForSchema(schema)),
					tooltips({
						parent: element.closest<HTMLElement>(".atelier-root") ?? undefined,
					}),
					Prec.highest(
						keymap.of(
							["Ctrl-Enter", "Meta-Enter"].map((key) => ({
								key,
								run: () => {
									closeCompletion(view);
									callbacks.current.onRun();
									return true;
								},
							})),
						),
					),
					keymap.of([
						...completionKeymap,
						{ key: "Tab", run: acceptCompletion },
						indentWithTab,
						...defaultKeymap,
						...historyKeymap,
					]),
					EditorView.contentAttributes.of({
						"aria-label": "SQL query",
						"data-attr": "sql-query-editor",
						spellcheck: "false",
					}),
					EditorView.updateListener.of((update) => {
						if (update.docChanged)
							callbacks.current.onQueryChange(update.state.doc.toString());
					}),
					EditorView.theme({
						"&.cm-editor": {
							height: "100%",
							fontSize: "13px",
							backgroundColor: "transparent",
						},
						".cm-scroller": {
							overflow: "auto",
							fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
						},
						".cm-content": { padding: "14px 0", lineHeight: "1.85" },
						".cm-line": { padding: "0 16px 0 12px" },
						".cm-gutters": {
							backgroundColor: "transparent",
							border: "none",
							color: "var(--color-text-tertiary)",
							paddingLeft: "8px",
						},
						"&.cm-focused": { outline: "none" },
						".cm-cursor": { borderLeftColor: "var(--color-text-primary)" },
					}),
				],
			}),
		});
		viewRef.current = view;
		handle.current = {
			focus: () => view.focus(),
			insertFunction: (fn) => {
				const selection = view.state.selection.main;
				snippet(functionTemplate(fn))(
					view,
					{ label: fn.name },
					selection.from,
					selection.to,
				);
				view.focus();
				requestAnimationFrame(() => view.focus());
			},
		};
		return () => {
			handle.current = null;
			viewRef.current = null;
			view.destroy();
		};
		// Editor lifetime follows its mount; document and catalog updates reconfigure it below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useLayoutEffect(() => {
		const view = viewRef.current;
		if (view && view.state.doc.toString() !== query)
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: query },
			});
	}, [query]);
	useLayoutEffect(() => {
		viewRef.current?.dispatch({
			effects: configuration.current.reconfigure(extensionsForSchema(schema)),
		});
	}, [schema]);
	return (
		<div className="atelier-sql-editor-shell">
			<div ref={parent} className="atelier-sql-codemirror" />
		</div>
	);
}
