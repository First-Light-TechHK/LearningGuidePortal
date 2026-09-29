export function accessPath(url: string): string;
export function accessLogLine(entry: { method: string; host: string; path: string; status: number | null; durationMs: number; outcome: string; ua: string }): string;
export function logAccess(req: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> }, res: { statusCode?: number }, started: number, outcome: string, write?: (line: string) => void): void;
export function bindAccess(req: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> }, res: { statusCode?: number; writableFinished?: boolean; on(event: string, listener: () => void): unknown }, started: number, write?: (line: string) => void): void;
export function holdConnection(server: { headersTimeout: number; keepAliveTimeout: number; on(event: string, listener: () => void): unknown }): void;
export const KEEP_ALIVE_MS: number;
export const HEADERS_TIMEOUT_MS: number;
export function installAccessLog(): void;
