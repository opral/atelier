import { Atelier as Workspace } from "./create-atelier";
import { History } from "./history";

/** Declarative workspace, with the composable history surface. */
export const Atelier = Object.assign(Workspace, { History });
export type { AtelierProps } from "./create-atelier";
