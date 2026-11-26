// The types of reports.mjs, for vite.config.ts.
import type { IncomingMessage, ServerResponse } from "node:http";

export function serverDll(): string | null;
export function fileReport(body: string, player: string): Promise<string>;
export function reportMiddleware(): (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
