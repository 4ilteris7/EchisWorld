import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageDirectory = path.dirname(require.resolve("maplibre-gl/package.json"));
const sourceDirectory = path.join(packageDirectory, "dist");
const targetDirectory = path.join(process.cwd(), "public", "maplibre");

mkdirSync(targetDirectory, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(sourceDirectory, file), path.join(targetDirectory, file));
}

console.log("MapLibre worker assets prepared in public/maplibre.");
