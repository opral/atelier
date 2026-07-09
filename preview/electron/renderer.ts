import { createAtelier } from "@opral/atelier";
import "@opral/atelier/style.css";
import { createPreviewLix } from "./lix-client";
import "./style.css";

const element = document.querySelector<HTMLElement>("#atelier");
if (!element) throw new Error("Atelier preview mount element is missing");

createAtelier({ element, lix: createPreviewLix() });
