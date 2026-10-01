import type { Plugin } from "vite";

export function isolateTailwind(css: string): string;
export function privateTailwind(): Plugin;
