// Structured logging for backend processes (roadmap §15).
//
// One JSON object per line on stdout/stderr so Docker's log driver can rotate
// and ship them. Aggregate counts and error codes only — never feed bodies,
// secrets, connection strings, or full item content.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): number {
  const configured = (process.env.ECHIS_LOG_LEVEL ?? "info") as LogLevel;
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}
