import { Atelier as Workspace } from "./create-atelier";
import { HistoryScopeSwitch } from "./extensions/history";
import { History } from "./history";

/** Declarative workspace, with the composable history surface. */
export const Atelier = Object.assign(Workspace, {
	History,
	HistoryScopeSwitch,
});
export type { AtelierProps } from "./create-atelier";
