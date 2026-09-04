import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticLogger = {
  log(level: LogLevel, event: string, details?: Record<string, unknown>): void;
  debug(event: string, details?: Record<string, unknown>): void;
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
};

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function createDiagnosticLogger(directory?: string): DiagnosticLogger {
  const file = directory
    ? (() => {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const path = join(
          directory,
          `archershub-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.jsonl`
        );
        return path;
      })()
    : undefined;

  const log = (
    level: LogLevel,
    event: string,
    details: Record<string, unknown> = {}
  ) => {
    const sanitized = Object.fromEntries(
      Object.entries(details).map(([key, value]) => [
        key.toLowerCase().includes("url") && typeof value === "string"
          ? key
          : key,
        key.toLowerCase().includes("url") && typeof value === "string"
          ? safeUrl(value)
          : value,
      ])
    );
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...sanitized,
    };
    const line = JSON.stringify(record);
    if (file) appendFileSync(file, `${line}\n`, { mode: 0o600 });
    if (level === "error" || level === "warn") console.error(line);
  };

  return {
    log,
    debug: (event, details) => log("debug", event, details),
    info: (event, details) => log("info", event, details),
    warn: (event, details) => log("warn", event, details),
    error: (event, details) => log("error", event, details),
  };
}
