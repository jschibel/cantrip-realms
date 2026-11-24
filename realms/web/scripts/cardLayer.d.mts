// The types of cardLayer.mjs, for vite.config.ts.
import type { Server } from "node:http";

export const cardLayerRoot: string;
export const offlineCatalog: string;
export function cardLayerBuilt(): boolean;
export function serveCardLayer(port: number, options?: { quiet?: boolean }): Promise<Server>;
