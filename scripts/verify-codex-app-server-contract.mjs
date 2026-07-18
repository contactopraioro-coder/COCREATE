import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CODEX_APP_SERVER_PROTOCOL_MANIFEST } from "../infrastructure/codex-app-server/protocol-manifest.js";
import { normalizeCodexVersion } from "../shared/codex-upstream-contracts.js";

const execFileAsync = promisify(execFile);
const binary = process.env.CODEX_BINARY ?? "codex";
const outputDirectory = await mkdtemp(path.join(tmpdir(), "cocreate-codex-contract-"));

try {
  const versionResult = await execFileAsync(binary, ["--version"], { timeout: 5_000 });
  const version = normalizeCodexVersion(versionResult.stdout || versionResult.stderr);
  if (version !== CODEX_APP_SERVER_PROTOCOL_MANIFEST.codexVersion) {
    throw new Error(
      `Expected Codex ${CODEX_APP_SERVER_PROTOCOL_MANIFEST.codexVersion}, received ${version ?? "unknown"}.`
    );
  }

  await execFileAsync(binary, [
    "app-server",
    "generate-ts",
    "--out",
    outputDirectory,
    "--experimental"
  ], { timeout: 30_000 });

  const files = {
    clientRequests: await readFile(path.join(outputDirectory, "ClientRequest.ts"), "utf8"),
    clientNotifications: await readFile(path.join(outputDirectory, "ClientNotification.ts"), "utf8"),
    serverRequests: await readFile(path.join(outputDirectory, "ServerRequest.ts"), "utf8"),
    serverNotifications: await readFile(path.join(outputDirectory, "ServerNotification.ts"), "utf8")
  };
  for (const [group, methods] of Object.entries({
    clientRequests: CODEX_APP_SERVER_PROTOCOL_MANIFEST.clientRequests,
    clientNotifications: CODEX_APP_SERVER_PROTOCOL_MANIFEST.clientNotifications,
    serverRequests: CODEX_APP_SERVER_PROTOCOL_MANIFEST.serverRequests,
    serverNotifications: CODEX_APP_SERVER_PROTOCOL_MANIFEST.serverNotifications
  })) {
    for (const method of methods) {
      if (!files[group].includes(`"method": "${method}"`)) {
        throw new Error(`Official generated ${group} contract is missing ${method}.`);
      }
    }
  }
  for (const [group, methods] of Object.entries(CODEX_APP_SERVER_PROTOCOL_MANIFEST.experimental)) {
    for (const method of methods) {
      if (!files[group].includes(`"method": "${method}"`)) {
        throw new Error(`Official generated experimental ${group} contract is missing ${method}.`);
      }
    }
  }

  const digest = createHash("sha256").update(Object.values(files).join("\n")).digest("hex");
  console.log(JSON.stringify({
    ok: true,
    codexVersion: version,
    protocolVersion: CODEX_APP_SERVER_PROTOCOL_MANIFEST.protocolVersion,
    framing: CODEX_APP_SERVER_PROTOCOL_MANIFEST.framing,
    requiredMethods: Object.values(CODEX_APP_SERVER_PROTOCOL_MANIFEST)
      .filter(Array.isArray)
      .reduce((total, entries) => total + entries.length, 0),
    experimentalMethods: Object.values(CODEX_APP_SERVER_PROTOCOL_MANIFEST.experimental)
      .reduce((total, entries) => total + entries.length, 0),
    generatedContractDigest: digest
  }, null, 2));
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
