import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateAssistantReply, transcribeAudio } from "./server/assistant";

function readJsonBody(request: import("node:http").IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (cause) {
        reject(cause);
      }
    });
    request.on("error", reject);
  });
}

async function runCodex(prompt: string) {
  const runDir = await mkdtemp(path.join(tmpdir(), "cocreate-codex-"));
  const lastMessagePath = path.join(runDir, "last-message.txt");

  return new Promise<{ ok: boolean; output: string; stderr?: string }>((resolve, reject) => {
    const child = spawn(
      process.env.CODEX_BINARY ?? "codex",
      [
        "exec",
        "--cd",
        process.cwd(),
        "--sandbox",
        "workspace-write",
        "--output-last-message",
        lastMessagePath,
        "-"
      ],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex tardó demasiado y se detuvo la ejecución."));
    }, 10 * 60 * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (cause) => {
      clearTimeout(timeout);
      rm(runDir, { recursive: true, force: true }).catch(() => {});
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = stdout.trim();
      const diagnostics = stderr.trim();
      if (code === 0) {
        readFile(lastMessagePath, "utf8")
          .catch(() => output || diagnostics || "Codex terminó sin salida.")
          .then((lastMessage) => {
            resolve({
              ok: true,
              output: lastMessage.trim() || output || diagnostics || "Codex terminó sin salida.",
              stderr: diagnostics
            });
          })
          .finally(() => {
            rm(runDir, { recursive: true, force: true }).catch(() => {});
          });
        return;
      }

      rm(runDir, { recursive: true, force: true }).catch(() => {});
      reject(new Error(diagnostics || output || `Codex terminó con código ${code}.`));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "cocreate-codex-dev-api",
      configureServer(server) {
        server.middlewares.use("/api/codex/run", async (request, response) => {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          try {
            const payload = await readJsonBody(request);
            const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
            if (!prompt) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "No hay prompt para ejecutar." }));
              return;
            }

            const result = await runCodex(prompt);
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result));
          } catch (cause) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: cause instanceof Error ? cause.message : "No pude ejecutar Codex."
              })
            );
          }
        });

        server.middlewares.use("/api/chat", async (request, response) => {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          try {
            const payload = await readJsonBody(request);
            const result = await generateAssistantReply({
              prompt: typeof payload.prompt === "string" ? payload.prompt : "",
              history: Array.isArray(payload.history) ? (payload.history as any[]) : []
            });
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result));
          } catch (cause) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: cause instanceof Error ? cause.message : "No pude responder desde CoCreate Web."
              })
            );
          }
        });

        server.middlewares.use("/api/transcribe", async (request, response) => {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          try {
            const payload = await readJsonBody(request);
            const result = await transcribeAudio({
              audioBase64: typeof payload.audioBase64 === "string" ? payload.audioBase64 : "",
              mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "audio/webm",
              language: typeof payload.language === "string" ? payload.language : "es"
            });
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result));
          } catch (cause) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: cause instanceof Error ? cause.message : "No pude transcribir la nota de voz."
              })
            );
          }
        });
      }
    }
  ],
  server: {
    port: 5173
  }
});
