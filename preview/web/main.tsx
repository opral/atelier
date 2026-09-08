import { openLix } from "@lix-js/sdk";
import type { Lix } from "@lix-js/sdk";
import { OpfsStorage } from "@lix-js/storage-opfs";
import {
	Atelier,
	AtelierDeveloperTools,
	createLixBranchSession,
} from "@opral/atelier";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "@opral/atelier/style.css";
import { HostBrandMark, HostRepositoryPicker } from "./host-navbar";
import { seedCsvDemo } from "./seed-csv-demo";
import { seedWorkspace } from "./seed-workspace";
import "./style.css";

const element = document.querySelector<HTMLElement>("#atelier");
if (!element) throw new Error("Atelier web preview mount element is missing");
const mountElement = element;

async function start() {
	const lix = await openLix({
		storage: new OpfsStorage({ name: "atelier-preview-lix-opfs-0.12" }),
	});
	await seedWorkspace(lix);
	await seedCsvDemo(lix);
	const params = new URLSearchParams(window.location.search);
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
							background: "#f7f6f3",
							borderBottom: "1px solid #e9e8e4",
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
	createRoot(mountElement).render(<PreviewApp lix={lix} />);
}

function PreviewApp({ lix }: { readonly lix: Lix }) {
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
			onEvent={(event) => {
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
