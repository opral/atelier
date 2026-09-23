import { openLix } from "@lix-js/sdk";
import type { Lix } from "@lix-js/sdk";
import { OpfsStorage } from "@lix-js/storage-opfs";
import {
	Atelier,
	conversationLocation,
	createLixBranchSession,
} from "@opral/atelier";
import { AtelierDeveloperTools } from "@opral/atelier/dev-tools";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "@opral/atelier/style.css";
import {
	HostBrandMark,
	HostRepositoryPicker,
	PREVIEW_ACCOUNT_NAME,
} from "./host-navbar";
import { installMarkdownPlugin } from "./install-markdown-plugin";
import { seedCommentsDemo } from "./seed-comments-demo";
import { seedConversationDemo } from "./seed-conversation-demo";
import { seedCsvDemo } from "./seed-csv-demo";
import { seedWorkspace } from "./seed-workspace";
import "./style.css";

const element = document.querySelector<HTMLElement>("#atelier");
if (!element) throw new Error("Atelier web preview mount element is missing");
const mountElement = element;

/**
 * Comments are signed by the active account, which a new lix calls
 * "Anonymous". The top bar's chip is who the preview reads as, so the
 * account takes its name and a demo comment shows a real author.
 */
async function namePreviewAccount(lix: Lix) {
	await lix.execute(
		"UPDATE lix_account SET name = $1 WHERE id = lix_active_account_id() AND name = 'Anonymous'",
		[PREVIEW_ACCOUNT_NAME],
	);
}

async function start() {
	const lix = await openLix({
		storage: new OpfsStorage({ name: "atelier-preview-lix-opfs-0.12" }),
	});
	// Before seeding: the plugin projects files as they are written.
	await installMarkdownPlugin(lix);
	// Before seeding too, so the rename lands in the demo's first checkpoint
	// rather than showing as a working change.
	await namePreviewAccount(lix);
	await seedWorkspace(lix);
	await seedCsvDemo(lix);
	const params = new URLSearchParams(window.location.search);
	if (params.get("demo") === "comments") await seedCommentsDemo(lix);
	if (params.get("demo") === "conversations") await seedConversationDemo(lix);
	const filePath = params.get("file");
	if (filePath) {
		const result = await lix.execute(
			"SELECT id FROM lix_file WHERE path = $1",
			[filePath],
		);
		const fileId = result.rows[0]?.id;
		if (typeof fileId !== "string")
			throw new Error(`File not found: ${filePath}`);
		createRoot(mountElement).render(
			<main
				style={{
					height: "100%",
					overflowY: "auto",
					display: "flex",
					flexDirection: "column",
				}}
			>
				{filePath.endsWith(".csv") && (
					<nav
						className="csv-demo-nav"
						style={{
							display: "flex",
							gap: 20,
							padding: "12px 20px",
							fontSize: 13,
							background: "var(--atelier-bg)",
							borderBottom: "1px solid var(--atelier-border)",
						}}
					>
						<a href="/">Atelier</a>
						<a
							href="?file=/csv-extension/pipeline.csv&edit=1"
							style={{
								fontWeight: filePath.endsWith("/pipeline.csv") ? 600 : 400,
							}}
						>
							Pipeline
						</a>
						<a
							href="?file=/csv-extension/plain-pipeline.csv&edit=1"
							style={{
								fontWeight: filePath.endsWith("/plain-pipeline.csv")
									? 600
									: 400,
							}}
						>
							Plain CSV
						</a>
					</nav>
				)}
				<div
					style={
						filePath.endsWith(".csv")
							? {
									display: "flex",
									flexDirection: "column",
									flex: 1,
									minHeight: 0,
								}
							: { maxWidth: 960, margin: "0 auto", padding: "48px 24px" }
					}
				>
					<Atelier
						lix={lix}
						location={{ path: filePath }}
						defaultOpenPanels={[]}
						readOnly={params.get("edit") !== "1"}
						navigation={{
							href: (location) =>
								"path" in location
									? `?${new URLSearchParams({ file: location.path })}`
									: "/",
							navigate: (location) => {
								if ("path" in location)
									window.location.search = new URLSearchParams({
										file: location.path,
									}).toString();
							},
						}}
					/>
				</div>
			</main>,
		);
		return;
	}
	// The preview is a dev tool: scripts (visual QA) may reach the workspace.
	Object.assign(window, { atelierPreviewLix: lix, atelierPreviewEvents: [] });
	// `?conversation=<uuid>` opens that conversation's view.
	const conversationId = params.get("conversation");
	createRoot(mountElement).render(
		<PreviewApp lix={lix} conversationId={conversationId} />,
	);
}

function PreviewApp({
	lix,
	conversationId,
}: {
	readonly lix: Lix;
	readonly conversationId?: string | null;
}) {
	const [location] = useState(() =>
		conversationId ? conversationLocation(conversationId) : undefined,
	);
	const [currentFile, setCurrentFile] = useState<string | null>(null);
	const [branchSession] = useState(() => createLixBranchSession(lix));
	const branchId = useSyncExternalStore(
		branchSession.subscribe,
		branchSession.getSnapshot,
		branchSession.getSnapshot,
	);
	return (
		<Atelier
			lix={lix}
			branchSession={branchSession}
			location={location}
			onEvent={(event) => {
				// Visual QA reads what a routing host would receive.
				(
					window as { atelierPreviewEvents?: unknown[] }
				).atelierPreviewEvents?.push(event);
				if (event.type === "document_viewed") setCurrentFile(event.filePath);
				else if (event.type === "document_closed")
					setCurrentFile(event.nextFilePath);
			}}
			slots={{
				navbarBrand: <HostBrandMark />,
				navbarRepository: <HostRepositoryPicker />,
				navbarEnd: (
					<AtelierDeveloperTools
						lix={lix}
						currentFile={currentFile}
						branchId={branchId}
					/>
				),
			}}
		/>
	);
}

void start().catch((error: unknown) => {
	console.error("Unable to start the Atelier web preview", error);
	mountElement.replaceChildren();
	const message = document.createElement("pre");
	message.textContent =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	mountElement.append(message);
});
