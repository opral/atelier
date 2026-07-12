const CODE_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
	bash: "Bash",
	css: "CSS",
	html: "HTML",
	js: "JavaScript",
	javascript: "JavaScript",
	json: "JSON",
	jsx: "JavaScript JSX",
	md: "Markdown",
	markdown: "Markdown",
	py: "Python",
	python: "Python",
	sh: "Shell",
	ts: "TypeScript",
	tsx: "TypeScript JSX",
	yaml: "YAML",
	yml: "YAML",
};

export function codeLanguageLabel(language: string): string {
	const normalized = language.trim().toLowerCase();
	return CODE_LANGUAGE_LABELS[normalized] ?? language.trim();
}
