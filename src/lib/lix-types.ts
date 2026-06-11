import type {
	ExecuteResult,
	Lix as SdkLix,
	LixTransaction as SdkLixTransaction,
	OpenLixOptions as SdkOpenLixOptions,
} from "@lix-js/sdk";

export type {
	CreateBranchOptions,
	CreateBranchReceipt,
	ExecuteResult as LixRuntimeQueryResult,
	MergeBranchOptions,
	MergeBranchPreview,
	MergeBranchReceipt,
	SwitchBranchOptions,
	SwitchBranchReceipt,
} from "@lix-js/sdk";

export type LixRow = ExecuteResult["rows"][number];

export type ExecuteOptions = {
	writerKey?: string | null;
};

export type TransactionStatement = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

export type SqlTransaction = Pick<SdkLixTransaction, "commit" | "rollback"> & {
	execute(sql: string, params?: ReadonlyArray<unknown>): Promise<ExecuteResult>;
};

export type ObserveQuery = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

export type ObserveEvent = {
	sequence: number;
	rows: ReadonlyArray<ReadonlyArray<unknown>>;
	columns?: string[];
};

export type ObserveEvents = {
	/** First event is the current result snapshot; later events are changes. */
	next(): Promise<ObserveEvent | undefined>;
	close(): void;
};

export type OpenLixKeyValueEntry = {
	key: string;
	value: unknown;
	lixcol_untracked?: boolean;
} & (
	| {
			lixcol_branch_id: string;
			lixcol_global: boolean;
	  }
	| {
			lixcol_branch_id?: undefined;
			lixcol_global?: boolean;
	  }
);

export type OpenLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkLixBase = Pick<
	SdkLix,
	"activeBranchId" | "createBranch" | "switchBranch" | "close"
>;

export interface FlashtypeLix extends SdkLixBase {
	execute(
		sql: string,
		params?: ReadonlyArray<unknown>,
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
	beginTransaction(options?: ExecuteOptions): Promise<SqlTransaction>;
	transaction<T>(
		options: ExecuteOptions,
		callback: (tx: SqlTransaction) => Promise<T>,
	): Promise<T>;
	transaction<T>(callback: (tx: SqlTransaction) => Promise<T>): Promise<T>;
	executeTransaction(
		statements: ReadonlyArray<TransactionStatement>,
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
	observe(query: ObserveQuery): ObserveEvents;
	mergeBranchPreview?: SdkLix["mergeBranchPreview"];
	mergeBranch?: SdkLix["mergeBranch"];
	exportSnapshot(): Promise<Uint8Array>;
}

export type Lix = FlashtypeLix;
