import type { Lix } from "@lix-js/sdk";
import { createAtelier } from "../../src";
import { createPreviewLix } from "./lix-client";
import "./style.css";

const element = document.querySelector<HTMLElement>("#atelier");
if (!element) throw new Error("Atelier preview mount element is missing");

createAtelier({ element, lix: createPreviewLix() as unknown as Lix });
