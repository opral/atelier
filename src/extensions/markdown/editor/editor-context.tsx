import * as React from "react";
import type { Editor } from "@tiptap/core";

type EditorContextValue = {
	editor: Editor | null;
	setEditor: React.Dispatch<React.SetStateAction<Editor | null>>;
};

const Ctx = React.createContext<EditorContextValue | undefined>(undefined);

export function EditorProvider({ children }: { children: React.ReactNode }) {
	const [editor, setEditor] = React.useState<Editor | null>(null);
	const value = React.useMemo(() => ({ editor, setEditor }), [editor]);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditorCtx() {
	const ctx = React.useContext(Ctx);
	if (!ctx)
		throw new Error("useEditorCtx must be used within <EditorProvider>");
	return ctx;
}
