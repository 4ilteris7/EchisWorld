// Database backup (F7B) — a consistent custom-format dump via pg_dump.
//
// Usage:
//   node scripts/db-backup.mjs [--out backups/echis-<ts>.dump]
//
// Connection comes from ECHIS_DATABASE_URL_OWNER (owner role; pg_dump needs
// read on every object). Produces a `-Fc` (custom, compressed) dump plus a
// SHA-256 checksum sidecar so a later restore can verify integrity.
//
// Requires pg_dump on PATH (matching the server major version). In the local
// Docker setup you can instead run it through the container:
//   docker exec echis-backend-db-1 pg_dump -Fc -U echis_owner echis > out.dump

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url =
  process.env.ECHIS_DATABASE_URL_OWNER ??
  "postgres://echis_owner:echis_local_owner_dev@127.0.0.1:5432/echis";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.resolve(arg("--out", `backups/echis-${stamp}.dump`));
mkdirSync(path.dirname(outPath), { recursive: true });

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

const child = spawn(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", outPath, url],
  { stdio: ["ignore", "inherit", "inherit"] },
);

child.on("error", (err) => {
  console.error(`pg_dump failed to start: ${err.message}`);
  console.error("Is pg_dump on PATH? See the header for the docker alternative.");
  process.exitCode = 1;
});

child.on("close", async (code) => {
  if (code !== 0) {
    console.error(`pg_dump exited with code ${code}`);
    process.exitCode = code ?? 1;
    return;
  }
  const checksum = await sha256(outPath);
  await writeFile(`${outPath}.sha256`, `${checksum}  ${path.basename(outPath)}\n`);
  console.log(`backup written: ${outPath}`);
  console.log(`sha256: ${checksum}`);
});
