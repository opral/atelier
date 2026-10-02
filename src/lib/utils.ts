import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `atw` keeps utility implementation names separate from --atelier-* tokens.
const twMerge = extendTailwindMerge({
	prefix: "atw",
	extend: {
		classGroups: { "font-size": [{ text: ["ui-xs", "ui-sm", "ui", "ui-lg"] }] },
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
