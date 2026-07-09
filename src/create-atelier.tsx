import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { ExecuteResult, Lix as SdkLix, SqlParam } from "@lix-js/sdk";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { LixProvider } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { V2LayoutShell } from "@/shell/layout-shell";
import "./index.css";

export function createAtelier(options: {
	readonly element: HTMLElement;
	readonly lix: SdkLix;
}): void {
	if (!(options.element instanceof HTMLElement)) {
		throw new TypeError("createAtelier() requires an HTMLElement");
	}

	const lix = toRuntimeLix(options.lix);
	const root = createRoot(options.element);
	root.render(
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<Suspense fallback={<AtelierLoadingPlaceholder />}>
					<V2LayoutShell />
				</Suspense>
			</KeyValueProvider>
		</LixProvider>,
	);
}

function toRuntimeLix(lix: SdkLix): Lix {
	if ("transaction" in lix && "executeTransaction" in lix) {
		return lix as unknown as Lix;
	}

	const beginTransaction: Lix["beginTransaction"] = async () => {
		const transaction = await lix.beginTransaction();
		return {
			execute: (sql, params = [], options) =>
				transaction.execute(sql, [...params] as SqlParam[], options),
			commit: () => transaction.commit(),
			rollback: () => transaction.rollback(),
		};
	};

	const transaction: Lix["transaction"] = async (callback) => {
		const tx = await beginTransaction();
		try {
			const result = await callback(tx);
			await tx.commit();
			return result;
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	};

	return {
		execute: (sql, params = [], options) =>
			lix.execute(sql, [...params] as SqlParam[], options),
		beginTransaction,
		transaction,
		executeTransaction: (statements) =>
			transaction(async (tx) => {
				let result: ExecuteResult = {
					columns: [],
					rows: [],
					rowsAffected: 0,
					notices: [],
				};
				for (const statement of statements) {
					result = await tx.execute(statement.sql, statement.params ?? []);
				}
				return result;
			}),
		observe: (sql, params = []) => lix.observe(sql, [...params] as SqlParam[]),
		activeBranchId: () => lix.activeBranchId(),
		createBranch: (options) => lix.createBranch(options),
		switchBranch: (options) => lix.switchBranch(options),
		mergeBranchPreview: (options) => lix.mergeBranchPreview(options),
		mergeBranch: (options) => lix.mergeBranch(options),
		// The embedded app has no filesystem backend responsibilities.
		importFilesystemPaths: async () => {},
		syncDiskToLix: async () => {},
		close: () => lix.close(),
	};
}

function AtelierLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}
