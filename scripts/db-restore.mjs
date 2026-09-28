// Database restore (F7B) — restore a pg_dump custom-format backup.
//
// Usage:
//   node scripts/db-restore.mjs --in backups/echis-<ts>.dump [--target <url>]
//
// SAFETY: restore is destructive. It refuses to run against the primary
// database URL unless --force is given; point --target at a disposable DB for
// verification. The checksum sidecar (if present) is verified first.
//
// Requires pg_restore on PATH (matching the server major version).

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(name);

const inPath = path.resolve(arg("--in", ""));
if (!inPath || !existsSync(inPath)) {
  console.error("missing or unreadable --in <dump file>");
  process.exit(1);
}

const primary =
  process.env.ECHIS_DATABASE_URL_OWNER ??
  "postgres://echis_owner:echis_local_owner_dev@127.0.0.1:5432/echis";
const target = arg("--target", primary);

if (target === primary && !has("--force")) {
  console.error(
    "refusing to restore over the primary database without --force.\n" +
      "point --target at a disposable database for verification.",
  );
  process.exit(1);
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const sidecar = `${inPath}.sha256`;
  if (existsSync(sidecar)) {
    const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    const actual = await sha256(inPath);
    if (expected !== actual) {
      console.error(`checksum mismatch: dump is corrupt or truncated.`);
      console.error(`  expected ${expected}\n  actual   ${actual}`);
      process.exit(1);
    }
    console.log("checksum OK");
  } else {
    console.warn("no .sha256 sidecar — skipping integrity check");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      "pg_restore",
      ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", target, inPath],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_restore exited ${code}`)),
    );
  });

  console.log(`restore complete into: ${target.replace(/:[^:@/]*@/, ":***@")}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
