import type { AtelierJsonValue } from "./extension-api";

/** A repository path or an extension-owned view. */
export type AtelierLocation =
	| {
			readonly path: string;
			readonly fileId?: string;
			readonly branchId?: string;
	  }
	| {
			readonly view: string;
			readonly state?: AtelierJsonValue;
			readonly branchId?: string;
	  };
