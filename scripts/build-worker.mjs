import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: root,
  entryPoints: ["./worker/index.ts"],
  outfile: "./dist/worker/index.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  alias: { "@": root },
  external: ["pg-native"],
  sourcemap: true,
  logLevel: "info",
});
