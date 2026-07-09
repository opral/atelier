type PreviewLixBridge = {
	execute(payload: unknown): Promise<{
		columns: string[];
		rows: unknown[][];
		rowsAffected: number;
		notices: Array<{ code: string; message: string; hint?: string }>;
	}>;
	transactionBegin(): Promise<string>;
	transactionExecute(payload: unknown): Promise<any>;
	transactionCommit(id: string): Promise<void>;
	transactionRollback(id: string): Promise<void>;
	observeStart(payload: unknown): Promise<string>;
	observeNext(id: string): Promise<any>;
	observeClose(id: string): Promise<void>;
	activeBranchId(): Promise<string>;
	createBranch(options: unknown): Promise<any>;
	switchBranch(options: unknown): Promise<any>;
	mergeBranchPreview(options: unknown): Promise<any>;
	mergeBranch(options: unknown): Promise<any>;
};

interface Window {
	atelierPreview: PreviewLixBridge;
}
