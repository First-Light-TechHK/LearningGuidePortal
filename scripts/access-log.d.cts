export function accessPath(url: string): string;
export function shouldLogAccess(path: string): boolean;
export function accessLogLine(entry: { method: string; path: string; status: number; durationMs: number }): string;
export function logFinishedAccess(req: { method?: string; url?: string }, res: { statusCode?: number }, started: number, write?: (line: string) => void): void;
export function holdConnection(server: { headersTimeout: number; keepAliveTimeout: number; on(event: string, listener: () => void): unknown }): void;
export const KEEP_ALIVE_MS: number;
export const HEADERS_TIMEOUT_MS: number;
export function installAccessLog(): void;
