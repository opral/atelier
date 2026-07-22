import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
	isolateHistory,
} from "@codemirror/commands";
import {
	HighlightStyle,
	LanguageDescription,
	defaultHighlightStyle,
	syntaxHighlighting,
} from "@codemirror/language";
import {
	closeSearchPanel,
	openSearchPanel,
	searchKeymap,
} from "@codemirror/search";
import {
	Annotation,
	Compartment,
	EditorState,
	Transaction,
	type Extension,
} from "@codemirror/state";
import {
	EditorView,
	crosshairCursor,
	dropCursor,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type TextEditorController = {
	readonly view: EditorView;
	readonly setDocument: (text: string) => void;
	readonly setReadOnly: (readOnly: boolean) => void;
	readonly setWrapping: (enabled: boolean) => void;
	readonly openSearch: () => void;
	readonly closeSearch: () => void;
	readonly destroy: () => void;
};

type TextCursorPosition = {
	readonly line: number;
	readonly column: number;
};

type CreateTextEditorArgs = {
	readonly parent: HTMLElement;
	readonly document: string;
	readonly filePath: string;
	readonly readOnly?: boolean;
	readonly wrapping?: boolean;
	readonly onChange?: (text: string) => void;
	readonly onCursorChange?: (position: TextCursorPosition) => void;
};

const atelierHighlightStyle = HighlightStyle.define([
	{
		tag: [
			tags.keyword,
			tags.controlKeyword,
			tags.definitionKeyword,
			tags.modifier,
		],
		color: "rgb(162, 28, 175)",
	},
	{
		tag: [
			tags.typeName,
			tags.className,
			tags.namespace,
			tags.function(tags.variableName),
			tags.standard(tags.variableName),
		],
		color: "rgb(29, 78, 216)",
	},
	{
		tag: [tags.string, tags.special(tags.string), tags.regexp],
		color: "rgb(63, 125, 32)",
	},
	{
		tag: [tags.bool, tags.null, tags.number, tags.integer, tags.float],
		color: "rgb(194, 65, 12)",
	},
	{
		tag: [tags.comment, tags.meta],
		color: "rgb(120, 113, 108)",
		fontStyle: "italic",
	},
	{
		tag: [tags.propertyName, tags.attributeName],
		color: "rgb(3, 105, 161)",
	},
	{
		tag: [tags.invalid],
		color: "rgb(185, 28, 28)",
		textDecoration: "underline wavy",
	},
]);

const atelierEditorTheme = EditorView.theme({
	"&": {
		height: "100%",
		backgroundColor: "var(--color-bg-panel)",
		color: "var(--color-text-primary)",
		fontSize: "14px",
	},
	"&.cm-focused": { outline: "none" },
	".cm-scroller": {
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		lineHeight: "1.72",
		overflow: "auto",
		boxSizing: "border-box",
		paddingTop: "12px",
	},
	".cm-content": {
		caretColor: "var(--color-text-primary)",
		padding: "0 0 16px",
	},
	".cm-line": { padding: "0 20px 0 8px" },
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--color-text-primary)",
		borderLeftWidth: "1.5px",
	},
	".cm-content ::selection, &.cm-focused .cm-content ::selection": {
		backgroundColor: "var(--atelier-text-selection-bg)",
		color: "var(--atelier-text-selection-fg)",
	},
	".cm-activeLine": {
		backgroundColor:
			"color-mix(in srgb, var(--color-brand-50) 28%, transparent)",
	},
	".cm-gutters": {
		minWidth: "38px",
		backgroundColor: "var(--color-bg-panel)",
		color: "color-mix(in srgb, var(--color-text-tertiary) 58%, transparent)",
		border: "none",
		fontSize: "12px",
	},
	".cm-lineNumbers .cm-gutterElement": {
		minWidth: "38px",
		padding: "0 8px 0 4px",
		textAlign: "right",
	},
	".cm-activeLineGutter": {
		backgroundColor:
			"color-mix(in srgb, var(--color-brand-50) 28%, transparent)",
		color: "var(--color-text-tertiary)",
	},
	".cm-panels": {
		backgroundColor: "var(--color-bg-panel-muted)",
		color: "var(--color-text-secondary)",
	},
	".cm-panels.cm-panels-top": {
		borderBottom: "1px solid var(--color-border-subtle)",
	},
	".cm-searchMatch": {
		backgroundColor: "var(--color-bg-selection-current)",
		outline: "1px solid var(--color-border-selection-current)",
	},
	".cm-searchMatch.cm-searchMatch-selected": {
		backgroundColor: "var(--color-brand-100)",
		outlineColor: "var(--color-brand-500)",
	},
});

const externalDocumentUpdate = Annotation.define<boolean>();

const supportedLanguages = [
	LanguageDescription.of({
		name: "Python",
		extensions: ["py", "pyw", "pyi"],
		load: () =>
			import("@codemirror/lang-python").then(({ python }) => python()),
	}),
	LanguageDescription.of({
		name: "JSON",
		extensions: ["json", "jsonc", "webmanifest"],
		load: () => import("@codemirror/lang-json").then(({ json }) => json()),
	}),
	LanguageDescription.of({
		name: "TSX",
		extensions: ["tsx"],
		load: () =>
			import("@codemirror/lang-javascript").then(({ javascript }) =>
				javascript({ typescript: true, jsx: true }),
			),
	}),
	LanguageDescription.of({
		name: "TypeScript",
		extensions: ["ts", "mts", "cts"],
		load: () =>
			import("@codemirror/lang-javascript").then(({ javascript }) =>
				javascript({ typescript: true }),
			),
	}),
	LanguageDescription.of({
		name: "JSX",
		extensions: ["jsx"],
		load: () =>
			import("@codemirror/lang-javascript").then(({ javascript }) =>
				javascript({ jsx: true }),
			),
	}),
	LanguageDescription.of({
		name: "JavaScript",
		extensions: ["js", "mjs", "cjs"],
		load: () =>
			import("@codemirror/lang-javascript").then(({ javascript }) =>
				javascript(),
			),
	}),
	LanguageDescription.of({
		name: "CSS",
		extensions: ["css"],
		load: () => import("@codemirror/lang-css").then(({ css }) => css()),
	}),
];

export function languageDescriptionForPath(
	filePath: string,
): LanguageDescription | null {
	return LanguageDescription.matchFilename(supportedLanguages, filePath);
}

export function createTextEditor({
	parent,
	document,
	filePath,
	readOnly = false,
	wrapping = true,
	onChange,
	onCursorChange,
}: CreateTextEditorArgs): TextEditorController {
	const languageCompartment = new Compartment();
	const readOnlyCompartment = new Compartment();
	const editableCompartment = new Compartment();
	const wrappingCompartment = new Compartment();
	let destroyed = false;

	const reportCursor = (state: EditorState) => {
		if (!onCursorChange) return;
		const head = state.selection.main.head;
		const line = state.doc.lineAt(head);
		onCursorChange({ line: line.number, column: head - line.from + 1 });
	};

	const extensions: Extension[] = [
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightSpecialChars(),
		history(),
		dropCursor(),
		EditorState.allowMultipleSelections.of(true),
		rectangularSelection(),
		crosshairCursor(),
		highlightActiveLine(),
		keymap.of([
			...defaultKeymap,
			...historyKeymap,
			...searchKeymap,
			indentWithTab,
		]),
		syntaxHighlighting(atelierHighlightStyle),
		syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
		atelierEditorTheme,
		languageCompartment.of([]),
		readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
		editableCompartment.of(EditorView.editable.of(!readOnly)),
		wrappingCompartment.of(wrapping ? EditorView.lineWrapping : []),
		EditorView.updateListener.of((update) => {
			if (
				update.docChanged &&
				!update.transactions.some((transaction) =>
					transaction.annotation(externalDocumentUpdate),
				)
			) {
				onChange?.(update.state.doc.toString());
			}
			if (update.selectionSet || update.docChanged) reportCursor(update.state);
		}),
	];

	const view = new EditorView({
		parent,
		state: EditorState.create({ doc: document, extensions }),
	});
	reportCursor(view.state);

	const language = languageDescriptionForPath(filePath);
	if (language) {
		void language
			.load()
			.then((support) => {
				if (destroyed) return;
				view.dispatch({
					effects: languageCompartment.reconfigure(support),
				});
			})
			.catch(() => {
				// Syntax highlighting is optional; plain text remains usable.
			});
	}

	return {
		view,
		setDocument: (text) => {
			const current = view.state.doc.toString();
			if (current === text) return;
			const head = Math.min(view.state.selection.main.head, text.length);
			view.dispatch({
				changes: { from: 0, to: current.length, insert: text },
				selection: { anchor: head },
				annotations: [
					externalDocumentUpdate.of(true),
					Transaction.addToHistory.of(false),
					isolateHistory.of("full"),
				],
			});
		},
		setReadOnly: (nextReadOnly) => {
			view.dispatch({
				effects: [
					readOnlyCompartment.reconfigure(
						EditorState.readOnly.of(nextReadOnly),
					),
					editableCompartment.reconfigure(
						EditorView.editable.of(!nextReadOnly),
					),
				],
			});
		},
		setWrapping: (enabled) => {
			view.dispatch({
				effects: wrappingCompartment.reconfigure(
					enabled ? EditorView.lineWrapping : [],
				),
			});
		},
		openSearch: () => {
			openSearchPanel(view);
		},
		closeSearch: () => {
			closeSearchPanel(view);
		},
		destroy: () => {
			destroyed = true;
			view.destroy();
		},
	};
}
