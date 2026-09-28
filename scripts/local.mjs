// Local-only operations. Never accepts a remote DB URL or removes a data volume.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, ".env.echis-local");
const COMPOSE = ["compose", "--project-name", "echis-local", "--env-file", CONFIG,
  "-f", path.join(ROOT, "infra", "compose.desktop.yml")];
const DOCKER_START_TIMEOUT_MS = 180_000;
const WEB_START_TIMEOUT_MS = 120_000;

export function validateLocalSettings(settings) {
  for (const role of ["OWNER", "WORKER", "WEB"]) {
    if (!/^[a-f0-9]{48}$/.test(settings[`ECHIS_DB_${role}_PASSWORD`] ?? "")) {
      throw new Error(`Invalid local ${role} password format; keep the generated configuration.`);
    }
  }
  for (const key of ["ECHIS_LOCAL_DB_PORT", "ECHIS_LOCAL_WEB_PORT"]) {
    if (!/^\d+$/.test(settings[key] ?? "") || Number(settings[key]) < 1024 || Number(settings[key]) > 65535) {
      throw new Error(`Invalid local port: ${key}`);
    }
  }
  if (Number(settings.ECHIS_LOCAL_DB_PORT) === Number(settings.ECHIS_LOCAL_WEB_PORT)) {
    throw new Error("Local database and web ports must differ.");
  }
  return settings;
}

function setup() {
  if (!existsSync(CONFIG)) {
    const lines = ["# Generated local credentials. Do not commit, share, or regenerate for an existing volume."];
    for (const role of ["OWNER", "WORKER", "WEB"]) {
      lines.push(`ECHIS_DB_${role}_PASSWORD=${randomBytes(24).toString("hex")}`);
    }
    lines.push("ECHIS_LOCAL_DB_PORT=5433", "ECHIS_LOCAL_WEB_PORT=3000", "");
    writeFileSync(CONFIG, lines.join("\n"), { mode: 0o600, flag: "wx" });
    console.log("Local configuration created. Credentials were not printed.");
  }
  return validateLocalSettings(parseEnv(readFileSync(CONFIG, "utf8")));
}

function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: ROOT, windowsHide: true, shell: false,
      env: options.env ?? process.env,
      stdio: [
        options.input ? "pipe" : "ignore",
        options.output ?? (options.capture ? "pipe" : "inherit"),
        options.error ?? "inherit",
      ],
    });
    let output = "";
    if (options.capture && child.stdout) {
      child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    }
    if (options.input) {
      const input = createReadStream(options.input);
      input.on("error", reject);
      child.stdin.on("error", err => { if (err.code !== "EPIPE") reject(err); });
      child.on("close", () => input.destroy());
      input.pipe(child.stdin);
    }
    child.on("error", () => reject(new Error(`${binary} could not start. Check installation and Docker Desktop.`)));
    child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(`${binary} failed (exit ${code}).`)));
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function dockerReady() {
  try {
    await command("docker", ["info", "--format", "{{.ServerVersion}}"], {
      capture: true,
      error: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function dockerDesktopCandidates() {
  if (process.platform !== "win32") return [];
  return [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Docker", "Docker Desktop.exe")
      : null,
  ].filter(Boolean);
}

async function ensureDocker({ launchDesktop }) {
  try {
    await command("docker", ["--version"], { capture: true, error: "ignore" });
  } catch {
    throw new Error("Docker CLI was not found. Install Docker Desktop and reopen this launcher.");
  }
  if (await dockerReady()) return;
  if (!launchDesktop) {
    throw new Error("Docker Desktop is not running.");
  }

  const executable = dockerDesktopCandidates().find(candidate => existsSync(candidate));
  if (!executable) {
    throw new Error("Docker Desktop could not be started automatically. Open it once, then retry.");
  }
  console.log("Starting Docker Desktop…");
  const desktop = spawn(executable, [], {
    cwd: ROOT,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  desktop.on("error", () => {});
  desktop.unref();

  const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await dockerReady()) {
      console.log("Docker Desktop is ready.");
      return;
    }
    await delay(2_000);
  }
  throw new Error("Docker Desktop did not become ready within 3 minutes.");
}

function localUrl(settings) {
  return `http://127.0.0.1:${settings.ECHIS_LOCAL_WEB_PORT}`;
}

function openDefaultBrowser(url) {
  const launch = process.platform === "win32"
    ? ["explorer.exe", [url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(launch[0], launch[1], {
      cwd: ROOT,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function waitForWeb(url, signal, timeoutMs = WEB_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const health = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(2_500),
      });
      if (!health.ok) throw new Error("health_not_ready");
      // Pre-warm the Monitor route so the browser does not sit through the
      // first Turbopack/webpack compilation with a blank tab.
      const page = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (page.status < 500) return true;
    } catch {
      await delay(750);
    }
  }
  return false;
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch {}
      }
      finish();
    }, 15_000);
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

async function runDevelopmentProcesses(settings, { webpack }) {
  const url = localUrl(settings);
  const sharedEnv = { ...process.env, ...settings, ECHIS_BUILD_ID: "local" };
  const worker = spawn(
    process.execPath,
    ["--env-file-if-exists=.env.local", "dist/worker/index.cjs"],
    {
      cwd: ROOT,
      windowsHide: true,
      shell: false,
      stdio: "inherit",
      env: {
        ...sharedEnv,
        ECHIS_DATABASE_URL_WORKER: `postgres://echis_worker:${settings.ECHIS_DB_WORKER_PASSWORD}@127.0.0.1:${settings.ECHIS_LOCAL_DB_PORT}/echis`,
      },
    },
  );
  const web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      webpack ? "--webpack" : "--turbopack",
      "--hostname", "127.0.0.1",
      "--port", settings.ECHIS_LOCAL_WEB_PORT,
    ],
    {
      cwd: ROOT,
      windowsHide: true,
      shell: false,
      stdio: "inherit",
      env: {
        ...sharedEnv,
        ECHIS_DATABASE_URL_WEB: `postgres://echis_web:${settings.ECHIS_DB_WEB_PASSWORD}@127.0.0.1:${settings.ECHIS_LOCAL_DB_PORT}/echis`,
      },
    },
  );

  const readiness = new AbortController();
  void waitForWeb(url, readiness.signal).then(ready => {
    if (!ready || readiness.signal.aborted) return;
    console.log(`EchisWorld ready: ${url}`);
    if (!openDefaultBrowser(url)) console.log("Open the URL above in your browser.");
  });

  await new Promise((resolve, reject) => {
    let finishing = false;
    const signals = ["SIGINT", "SIGTERM", "SIGBREAK"];
    const removeSignalListeners = () => {
      for (const signal of signals) process.removeListener(signal, onSignal);
    };
    const finish = async error => {
      if (finishing) return;
      finishing = true;
      readiness.abort();
      removeSignalListeners();
      await Promise.all([stopChild(web), stopChild(worker)]);
      if (error) reject(error);
      else resolve();
    };
    const onSignal = () => { void finish(); };
    const watch = (label, child) => {
      child.once("error", error => {
        void finish(new Error(`${label} could not start: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        if (!finishing) {
          void finish(new Error(`${label} stopped unexpectedly (${signal ?? `exit ${code}`}).`));
        }
      });
    };
    for (const signal of signals) process.once(signal, onSignal);
    watch("Collector worker", worker);
    watch("Next.js development server", web);
  });
}

async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const action = process.argv[2];
  const actions = ["setup", "start", "open", "rebuild", "dev", "dev-webpack", "stop", "status", "backup", "restore", "geo"];
  if (!actions.includes(action)) {
    throw new Error("Use local:setup, local:start, local:open, local:rebuild, local:dev, dev:webpack, local:stop, local:status, local:backup, local:restore -- <dump>, or local:geo.");
  }
  const settings = setup();
  const env = { ...process.env, ...settings };
  const compose = (args, options) => command("docker", [...COMPOSE, ...args], { ...options, env });
  const sql = query => compose(["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "echis_owner", "-d", "echis", "-Atc", query], { capture: true });
  if (action === "setup") {
    console.log("Configuration ready. Provider keys remain in .env.local; no remote database settings are used.");
    return;
  }

  if (action === "stop" && !(await dockerReady())) {
    console.log("Docker Desktop is not running; local services are already stopped.");
    return;
  }
  if (action === "status" && !(await dockerReady())) {
    console.log("Docker Desktop is not running; EchisWorld is unavailable.");
    process.exitCode = 1;
    return;
  }
  await ensureDocker({ launchDesktop: true });

  const stackServices = ["migrate", "worker", "web"];
  const ensureStackImages = async force => {
    const missing = [];
    if (!force) {
      for (const service of stackServices) {
        const imageId = await compose(["images", "-q", service], { capture: true, error: "ignore" });
        if (!imageId) missing.push(service);
      }
    }
    const services = force ? stackServices : missing;
    if (services.length > 0) {
      console.log(force
        ? "Rebuilding EchisWorld application images…"
        : `Preparing first-run images: ${services.join(", ")}…`);
      await compose(["build", ...services]);
    }
  };
  const startStack = async forceBuild => {
    await ensureStackImages(forceBuild);
    await compose(["up", "-d", "--wait", "--wait-timeout", "240"]);
  };

  if (["start", "open", "rebuild"].includes(action)) {
    await startStack(action === "rebuild");
    const url = localUrl(settings);
    console.log(`EchisWorld: ${url}`);
    console.log("First collection may take several minutes. Source outages remain visible; no demo data is generated.");
    if (action === "open" && !openDefaultBrowser(url)) {
      console.log("The browser could not be opened automatically; use the URL above.");
    }
  } else if (action === "dev" || action === "dev-webpack") {
    // A production-style worker/web container may be left over from
    // `local:start`. Stop only those processes; the database volume survives.
    await compose(["stop", "--timeout", "60", "web", "worker"]);
    await compose(["up", "-d", "--wait", "db"]);
    console.log("Applying database migrations…");
    await command(process.execPath, ["scripts/db-migrate.mjs"], {
      env: {
        ...env,
        ECHIS_DATABASE_URL_OWNER: `postgres://echis_owner:${settings.ECHIS_DB_OWNER_PASSWORD}@127.0.0.1:${settings.ECHIS_LOCAL_DB_PORT}/echis`,
      },
    });
    console.log("Preparing the collector worker…");
    await command(process.execPath, ["scripts/build-worker.mjs"], { env });
    console.log(`Fast development mode (${action === "dev-webpack" ? "Webpack" : "Turbopack"}); Ctrl+C stops web and worker. PostgreSQL stays ready.`);
    if (action === "dev") console.log("Compatibility fallback: npm.cmd run dev:webpack");
    await runDevelopmentProcesses(settings, { webpack: action === "dev-webpack" });
  } else if (action === "stop") {
    await compose(["stop", "--timeout", "60"]);
    console.log("Local services stopped; all data preserved. VPS services unchanged.");
  } else if (action === "status") {
    await compose(["ps", "-a"]);
    try {
      const response = await fetch(`http://127.0.0.1:${settings.ECHIS_LOCAL_WEB_PORT}/api/health`, { signal: AbortSignal.timeout(7000) });
      console.log(JSON.stringify(await response.json(), null, 2));
      if (!response.ok) process.exitCode = 1;
    } catch {
      console.log("Local web is unavailable. Start with npm run local:start.");
      process.exitCode = 1;
    }
  } else if (action === "backup") {
    const dir = path.join(ROOT, "backups");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `local-${new Date().toISOString().replaceAll(":", "-")}.dump`);
    const fd = openSync(file, "wx", 0o600);
    try {
      await compose(["exec", "-T", "db", "pg_dump", "-U", "echis_owner", "-d", "echis", "-Fc", "--no-owner"], { output: fd });
    } finally { closeSync(fd); }
    writeFileSync(`${file}.sha256`, `${await checksum(file)}\n`);
    console.log(`Backup: ${file}`);
  } else if (action === "restore") {
    const arg = process.argv[3];
    if (!arg || !existsSync(path.resolve(ROOT, arg))) throw new Error("Supply an existing dump with its .sha256 sidecar.");
    const file = path.resolve(ROOT, arg);
    const expected = readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
    if (expected !== await checksum(file)) throw new Error("Backup checksum mismatch; no database changes made.");
    await compose(["up", "-d", "--wait", "db"]);
    // Restore only into this new, empty local database. Never --clean or --force.
    if (await sql("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") !== "0") {
      throw new Error("Restore refused: local database is not empty. Existing data was preserved.");
    }
    const running = await compose(["ps", "--services", "--status", "running"], { capture: true });
    if (running.split(/\r?\n/).some(service => ["web", "worker", "migrate"].includes(service))) {
      throw new Error("Stop web/worker/migrate before restoring; database must be unused.");
    }
    await compose(["exec", "-T", "db", "pg_restore", "-U", "echis_owner", "-d", "echis", "--no-owner", "--exit-on-error", "--single-transaction"], { input: file });
    console.log("Real data restored into isolated local storage. Run npm run local:start.");
  } else if (action === "geo") {
    const file = path.join(ROOT, "data", "admin-boundaries.ndjson");
    if (!existsSync(file)) throw new Error("Real boundary dataset missing. Run npm run geo:build first.");
    await command(process.execPath, ["scripts/load-admin-boundaries.mjs", file], {
      env: { ...env, ECHIS_DATABASE_URL_OWNER: `postgres://echis_owner:${settings.ECHIS_DB_OWNER_PASSWORD}@127.0.0.1:${settings.ECHIS_LOCAL_DB_PORT}/echis` },
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : "Local operation failed.");
    process.exitCode = 1;
  });
}
