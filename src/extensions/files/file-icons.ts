import fileCodeIconUrl from "./assets/file-code.svg";
import fileConfigIconUrl from "./assets/file-config.svg";
import fileCssIconUrl from "./assets/file-css.svg";
import fileCsvIconUrl from "./assets/file-csv.svg";
import fileGenericIconUrl from "./assets/file-generic.svg";
import fileHtmlIconUrl from "./assets/file-html.svg";
import fileJpgIconUrl from "./assets/file-jpg.svg";
import fileJsIconUrl from "./assets/file-js.svg";
import fileJsonIconUrl from "./assets/file-json.svg";
import fileMdIconUrl from "./assets/file-md.svg";
import filePdfIconUrl from "./assets/file-pdf.svg";
import filePngIconUrl from "./assets/file-png.svg";
import fileShellIconUrl from "./assets/file-shell.svg";
import fileSqlIconUrl from "./assets/file-sql.svg";
import fileSvgIconUrl from "./assets/file-svg.svg";
import fileTsIconUrl from "./assets/file-ts.svg";
import fileTxtIconUrl from "./assets/file-txt.svg";

export const FILE_ICON_GROUPS = [
	{ extensions: ["md", "markdown"], iconUrl: fileMdIconUrl },
	{ extensions: ["txt", "log"], iconUrl: fileTxtIconUrl },
	{ extensions: ["json", "jsonc"], iconUrl: fileJsonIconUrl },
	{ extensions: ["js", "jsx"], iconUrl: fileJsIconUrl },
	{ extensions: ["ts", "tsx"], iconUrl: fileTsIconUrl },
	{ extensions: ["css", "scss", "less"], iconUrl: fileCssIconUrl },
	{
		extensions: ["yaml", "yml", "toml", "xml", "ini", "cfg", "conf", "env"],
		iconUrl: fileConfigIconUrl,
	},
	{ extensions: ["sh", "bash", "zsh"], iconUrl: fileShellIconUrl },
	{ extensions: ["sql"], iconUrl: fileSqlIconUrl },
	{
		extensions: ["py", "rs", "go", "java", "c", "h", "cpp", "hpp", "rb", "php"],
		iconUrl: fileCodeIconUrl,
	},
	{ extensions: ["csv"], iconUrl: fileCsvIconUrl },
	{ extensions: ["png"], iconUrl: filePngIconUrl },
	{ extensions: ["svg"], iconUrl: fileSvgIconUrl },
	{ extensions: ["jpg", "jpeg"], iconUrl: fileJpgIconUrl },
	{ extensions: ["pdf"], iconUrl: filePdfIconUrl },
	{ extensions: ["html", "htm"], iconUrl: fileHtmlIconUrl },
] as const;

const ICON_URL_BY_EXTENSION = new Map<string, string>(
	FILE_ICON_GROUPS.flatMap(({ extensions, iconUrl }) =>
		extensions.map((extension) => [extension, iconUrl] as const),
	),
);

export function fileIconUrl(path: string): string {
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	return ICON_URL_BY_EXTENSION.get(extension) ?? fileGenericIconUrl;
}

export { fileGenericIconUrl };
