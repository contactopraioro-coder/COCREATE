import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, "release");
const requiredAsarEntries = [
  "/electron/main.mjs",
  "/electron/preload.cjs",
  "/shared/codex-contracts.js",
  "/shared/codex-ipc.js",
  "/shared/codex-ipc-channels.json",
  "/shared/codex-runner.js",
  "/shared/codex-upstream-contracts.js",
  "/shared/upstream-capability-exposure.js",
  "/infrastructure/codex-app-server/process-manager.js",
  "/infrastructure/codex-app-server/json-rpc-client.js",
  "/infrastructure/codex-app-server/cocreate-codex-client.js",
  "/infrastructure/codex-app-server/app-server-adapter.js",
  "/infrastructure/codex-app-server/runtime-selector.js",
  "/dist/index.html",
  "/overlay-dist/overlay.html",
  "/package.json"
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findAppBundle(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return absolutePath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nested = await findAppBundle(path.join(directory, entry.name)).catch(() => null);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

async function resolveAppBundlePath() {
  const explicitPath = readArgument("--app");
  if (explicitPath) {
    return path.resolve(rootDir, explicitPath);
  }

  const discovered = await findAppBundle(releaseDir);
  if (!discovered) {
    throw new Error("No encontré ninguna app empaquetada dentro de release/.");
  }

  return discovered;
}

function verifyAsarContents(asarPath) {
  const entries = new Set(asar.listPackage(asarPath));
  const missing = requiredAsarEntries.filter((entry) => !entries.has(entry));

  if (missing.length) {
    throw new Error(`Faltan entradas requeridas dentro de app.asar: ${missing.join(", ")}`);
  }
}

async function runPackagedAppSmoke(executablePath) {
  const timeoutMs = Number(process.env.COCREATE_SMOKE_TEST_TIMEOUT_MS ?? "20000");
  const resultDirectory = await mkdtemp(path.join(tmpdir(), "cocreate-desktop-smoke-"));
  const resultFile = path.join(resultDirectory, "result.json");

  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      cwd: rootDir,
      env: {
        ...process.env,
        CO_CREATE_SMOKE_TEST: "1",
        COCREATE_SMOKE_TEST_RESULT_FILE: resultFile,
        COCREATE_SMOKE_TEST_TIMEOUT_MS: String(timeoutMs)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          `El smoke test del binario empaquetado excedió ${timeoutMs}ms.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    }, timeoutMs);

    const resultPollId = setInterval(() => {
      void readFile(resultFile, "utf8")
        .then((raw) => {
          const payload = JSON.parse(raw);
          const isTerminalPayload = payload?.ok === true || payload?.phase === "failed";
          if (!isTerminalPayload) {
            return;
          }

          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeoutId);
          clearInterval(resultPollId);
          child.kill("SIGTERM");

          if (!payload?.ok) {
            reject(
              new Error(
                `La app empaquetada reportó un fallo en smoke mode.\nRESULT:\n${raw}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
              )
            );
            return;
          }

          resolve({
            stdout,
            stderr,
            result: payload
          });
        })
        .catch(() => undefined);
    }, 250);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      clearInterval(resultPollId);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      clearInterval(resultPollId);

      if (code !== 0) {
        reject(new Error(`La app empaquetada salió con código ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }

      resolve({
        stdout,
        stderr,
        result: null
      });
    });
  });
}

async function main() {
  const appBundlePath = await resolveAppBundlePath();
  const executableName = path.basename(appBundlePath, ".app");
  const executablePath = path.join(appBundlePath, "Contents", "MacOS", executableName);
  const asarPath = path.join(appBundlePath, "Contents", "Resources", "app.asar");

  if (!(await exists(asarPath))) {
    throw new Error(`No encontré app.asar en ${asarPath}`);
  }

  if (!(await exists(executablePath))) {
    throw new Error(`No encontré el binario ejecutable en ${executablePath}`);
  }

  verifyAsarContents(asarPath);
  const result = await runPackagedAppSmoke(executablePath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        appBundlePath,
        executablePath,
        checkedEntries: requiredAsarEntries,
        stdout: result.stdout.trim(),
        smokeResult: result.result
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
