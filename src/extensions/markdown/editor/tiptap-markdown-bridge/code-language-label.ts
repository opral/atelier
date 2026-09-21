/**
 * The languages the code block's language menu offers, in the order it
 * lists them. `id` is what the fence is written with; `aliases` are other
 * fence words for the same language, which get the same name.
 */
export const CODE_LANGUAGES: ReadonlyArray<{
	readonly id: string;
	readonly label: string;
	readonly aliases?: readonly string[];
}> = [
	{ id: "bash", label: "Bash" },
	{ id: "c", label: "C" },
	{ id: "cpp", label: "C++", aliases: ["c++"] },
	{ id: "csharp", label: "C#", aliases: ["cs", "c#"] },
	{ id: "css", label: "CSS" },
	{ id: "diff", label: "Diff" },
	{ id: "dockerfile", label: "Dockerfile", aliases: ["docker"] },
	{ id: "go", label: "Go", aliases: ["golang"] },
	{ id: "graphql", label: "GraphQL", aliases: ["gql"] },
	{ id: "html", label: "HTML" },
	{ id: "java", label: "Java" },
	{ id: "js", label: "JavaScript", aliases: ["javascript", "mjs", "cjs"] },
	{ id: "json", label: "JSON", aliases: ["jsonc"] },
	{ id: "jsx", label: "JavaScript JSX" },
	{ id: "kotlin", label: "Kotlin", aliases: ["kt"] },
	{ id: "markdown", label: "Markdown", aliases: ["md"] },
	{ id: "mermaid", label: "Mermaid" },
	{ id: "php", label: "PHP" },
	{ id: "python", label: "Python", aliases: ["py"] },
	{ id: "ruby", label: "Ruby", aliases: ["rb"] },
	{ id: "rust", label: "Rust", aliases: ["rs"] },
	{ id: "sh", label: "Shell", aliases: ["shell", "zsh"] },
	{ id: "sql", label: "SQL" },
	{ id: "swift", label: "Swift" },
	{ id: "toml", label: "TOML" },
	{ id: "ts", label: "TypeScript", aliases: ["typescript"] },
	{ id: "tsx", label: "TypeScript JSX" },
	{ id: "xml", label: "XML" },
	{ id: "yaml", label: "YAML", aliases: ["yml"] },
];

const CODE_LANGUAGE_LABELS: ReadonlyMap<string, string> = new Map(
	CODE_LANGUAGES.flatMap((language) =>
		[language.id, ...(language.aliases ?? [])].map(
			(word) => [word, language.label] as const,
		),
	),
);

export function codeLanguageLabel(language: string): string {
	const normalized = language.trim().toLowerCase();
	return CODE_LANGUAGE_LABELS.get(normalized) ?? language.trim();
}
