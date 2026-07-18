import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { generateAssistantReply, transcribeAudio } from "./api/_lib/assistant";
import { collectExecutionOutput, createNodeCodexAdapter } from "./shared/codex-runner.js";

const devStateStore = new Map<string, { snapshot: unknown; memorySummary: string }>();
const devCodexAdapter = createNodeCodexAdapter({
  cwd: process.cwd(),
  binary: process.env.CODEX_BINARY ?? "codex",
  defaultOrigin: "vite-dev-api"
});

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

export default defineConfig({
  base: "./",
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

            const result = await collectExecutionOutput(devCodexAdapter, {
              prompt,
              cwd: process.cwd(),
              origin: "vite-dev-api"
            });
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

        server.middlewares.use("/api/title", async (request, response) => {
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
              response.end(JSON.stringify({ error: "No hay prompt para titular." }));
              return;
            }

            const title = prompt
              .replace(/\s+/g, " ")
              .trim()
              .split(" ")
              .slice(0, 5)
              .join(" ")
              .slice(0, 48);

            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ ok: true, title: title || "Nuevo chat" }));
          } catch (cause) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: cause instanceof Error ? cause.message : "No pude generar el titulo."
              })
            );
          }
        });

        server.middlewares.use("/api/state", async (request, response) => {
          if (request.method === "GET") {
            const requestUrl = new URL(request.url ?? "/", "http://localhost");
            const clientId = requestUrl.searchParams.get("clientId")?.trim();
            const app = requestUrl.searchParams.get("app")?.trim() || "v01";

            if (!clientId) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Falta clientId para cargar el estado." }));
              return;
            }

            const entry = devStateStore.get(`${app}:${clientId}`) ?? null;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                ok: true,
                enabled: true,
                snapshot: entry?.snapshot ?? null,
                memorySummary: entry?.memorySummary ?? ""
              })
            );
            return;
          }

          if (request.method !== "POST") {
            response.statusCode = 405;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          try {
            const payload = await readJsonBody(request);
            const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
            const app = typeof payload.app === "string" ? payload.app.trim() : "v01";
            const snapshot = payload.snapshot ?? null;

            if (!clientId || !snapshot || typeof snapshot !== "object") {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: "Payload invalido para persistir estado." }));
              return;
            }

            devStateStore.set(`${app}:${clientId}`, {
              snapshot,
              memorySummary: ""
            });

            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ ok: true, enabled: true }));
          } catch (cause) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: cause instanceof Error ? cause.message : "No pude persistir la sesión web."
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
