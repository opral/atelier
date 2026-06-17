import path from "node:path";

export function getWorkspacePathArguments(argv, { defaultApp = false } = {}) {
	// Playwright/Electron can prepend runtime flags before app arguments.
	const appArguments = argv.slice(1).filter((argument) => {
		return argument !== "--" && !argument.startsWith("--");
	});
	if (defaultApp === true) {
		appArguments.shift();
	}
	return appArguments;
}

export function resolveWorkspacePathArguments(
	workspacePathArguments,
	workingDirectory = process.cwd(),
) {
	return workspacePathArguments.map((argument) =>
		path.isAbsolute(argument)
			? argument
			: path.resolve(workingDirectory, argument),
	);
}
