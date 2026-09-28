// EchisWorld collector worker entry point (F2A).
//
// Runs as its own process/container next to the Next.js web process — never
// inside it. Build with `npm run worker:build`, run with `npm run worker:start`.
//
// Flags (all optional, mainly for bounded local proofs):
//   --run-seconds N        stop gracefully after N seconds
//   --heartbeat-seconds N  heartbeat cadence (default 30)
//   --tick-seconds N       idle tick cadence (default 60)

import { WorkerLoop } from "./loop";
import { log } from "@/lib/backend/observability/log";

function numberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const loop = new WorkerLoop({
    runSeconds: numberFlag("--run-seconds"),
    heartbeatSeconds: numberFlag("--heartbeat-seconds"),
    tickSeconds: numberFlag("--tick-seconds"),
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => {
      void loop.stop(signal);
    });
  }
  process.on("unhandledRejection", (reason) => {
    log("error", "worker_unhandled_rejection", {
      detail: reason instanceof Error ? reason.message : String(reason),
    });
    process.exitCode = 1;
    void loop.stop("unhandled_rejection");
  });
  process.on("uncaughtException", (err) => {
    log("error", "worker_uncaught_exception", { detail: err.message });
    process.exitCode = 1;
    void loop.stop("uncaught_exception");
  });

  const outcome = await loop.run();
  if (outcome === "lock_busy") process.exitCode = 2;
}

main().catch((err) => {
  log("error", "worker_fatal", {
    detail: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
