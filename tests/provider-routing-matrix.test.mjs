import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderRegistry,
  ProviderRuntime,
  createFunctionProviderAdapter,
  createPlaceholderProvider
} from "../shared/provider-runtime.js";
import { analyzeAssistantIntent, runTrustedAssistantRuntime } from "../shared/trusted-assistant-runtime.js";

function capabilities(operation, domains) {
  return {
    operations: [operation],
    domains,
    streaming: false,
    tools: operation === "query" || operation === "search",
    reasoning: operation === "chat",
    multimodal: false,
    embeddings: false
  };
}

function toolProvider(id, domain, value) {
  return createFunctionProviderAdapter({
    id,
    capabilities: capabilities("query", [domain]),
    async execute() {
      return { value };
    }
  });
}

function createMatrixRuntime() {
  const events = [];
  const registry = new ProviderRegistry([
    toolProvider("datetime-tool", "datetime", {
      iso: "2026-07-16T15:00:00.000Z",
      resolvedAt: "2026-07-16T15:00:00.000Z",
      timezone: "America/Bogota",
      timezoneSource: "profile",
      locale: "es-CO",
      localDate: "jueves, 16 de julio de 2026",
      localTime: "10:00:00",
      dayOfWeek: "jueves",
      monthName: "julio",
      year: 2026,
      month: 7,
      day: 16
    }),
    toolProvider("workspace-tool", "workspace", {
      workspace: { name: "Workspace personal" },
      project: { name: "CoCreate" },
      task: { title: "Provider hardening" },
      conversation: { title: "Prompt #4.1" },
      conversations: [{ title: "Prompt #4.1" }, { title: "Prompt #4" }]
    }),
    toolProvider("identity-tool", "identity", {
      identity: { displayName: "Local User" },
      profile: { displayName: "Martin", timezone: "America/Bogota", locale: "es-CO" },
      device: { platform: "darwin", architecture: "arm64" }
    }),
    toolProvider("system-tool", "system", {
      platform: "darwin",
      architecture: "arm64",
      workingDirectory: "/workspace/cocreate",
      appVersion: "0.0.1"
    }),
    createFunctionProviderAdapter({
      id: "openai",
      capabilities: capabilities("chat", ["chat"]),
      async execute() { return { output: "Respuesta general" }; }
    }),
    createFunctionProviderAdapter({
      id: "codex",
      capabilities: capabilities("chat", ["chat", "coding"]),
      async execute() { return { output: "Respuesta de código" }; }
    }),
    createPlaceholderProvider({
      id: "web-tool",
      name: "Future Web Tool",
      capabilities: capabilities("search", ["web"])
    })
  ]);
  return {
    runtime: {
      providerRuntime: new ProviderRuntime({ registry, observer: (event) => events.push(event) }),
      diagnostics: { log: (event) => events.push(event) }
    },
    events
  };
}

const routingMatrix = [
  ...["¿Qué día es hoy?", "¿Qué hora es?", "¿Qué fecha es?", "What date is it today?", "Hoy", "Ahora", "Zona horaria", "Hora local", "Fecha actual"]
    .map((prompt) => ({ prompt, capability: "datetime", providerCapability: "datetime", provider: "datetime-tool", confidence: "Verified", classification: "DateTime" })),
  ...["¿Qué proyecto tengo abierto?", "¿Cuál es mi tarea activa?", "¿Qué conversaciones existen?", "¿Qué workspace estoy usando?"]
    .map((prompt) => ({ prompt, capability: "workspace", providerCapability: "workspace", provider: "workspace-tool", confidence: "Verified", classification: "Workspace" })),
  ...["¿Cómo me llamo?", "¿Quién soy?", "¿Qué perfil uso?", "¿Qué dispositivo estoy usando?"]
    .map((prompt) => ({ prompt, capability: "identity", providerCapability: "identity", provider: "identity-tool", confidence: "Verified", classification: "Identity" })),
  ...["¿Qué sistema operativo uso?", "¿Cuál es mi carpeta de trabajo?", "¿Cuál es mi versión?"]
    .map((prompt) => ({ prompt, capability: "system", providerCapability: "system", provider: "system-tool", confidence: "Verified", classification: "System" })),
  ...[
    "Explícame React.",
    "¿Qué es TypeScript?",
    "Haz un componente.",
    "Escribe una API.",
    "Crea el archivo cocreate-workspace-test.ts y ejecuta sus pruebas."
  ]
    .map((prompt) => ({ prompt, capability: "model", providerCapability: "coding", provider: "codex", confidence: "Estimated", classification: "Coding" })),
  ...["¿Quién es el presidente de Colombia?", "¿Quién es el Papa?", "¿Qué pasó hoy con OpenAI?", "Precio de Bitcoin.", "Clima en Medellín.", "Resultados deportivos recientes.", "Noticias recientes.", "Versión más reciente de React.", "¿Cuál es la última versión estable de Node.js?"]
    .map((prompt) => ({ prompt, capability: "web", providerCapability: "web", provider: "web-tool", confidence: "Unavailable", classification: "Web" })),
  ...["¿Qué es una zona horaria?", "Explícame TCP/IP.", "¿Cómo funciona Git?", "¿Qué es GraphQL?"]
    .map((prompt) => ({ prompt, capability: "model", providerCapability: "chat", provider: "openai", confidence: "Estimated", classification: "General Knowledge" }))
];

test("Provider routing matrix resolves every mandatory query without ambiguous providers", async () => {
  const { runtime } = createMatrixRuntime();
  for (const expected of routingMatrix) {
    const intent = analyzeAssistantIntent({ prompt: expected.prompt });
    assert.equal(intent.primaryCapability, expected.capability, expected.prompt);
    assert.equal(intent.providerCapability, expected.providerCapability, expected.prompt);
    assert.equal(intent.classification, expected.classification, expected.prompt);

    const response = await runTrustedAssistantRuntime({ prompt: expected.prompt }, runtime);
    assert.equal(response.provider, expected.provider, expected.prompt);
    assert.equal(response.confidence, expected.confidence, expected.prompt);
    assert.equal(response.classification, expected.classification, expected.prompt);
    assert.equal(response.metadata.routing.providerCapability, expected.providerCapability, expected.prompt);
    assert.equal(response.metadata.routing.requiredProvider, expected.provider, expected.prompt);
    assert.equal(
      response.metadata.routing.selectedProvider,
      expected.confidence === "Unavailable" ? null : expected.provider,
      expected.prompt
    );
    assert.equal(
      response.metadata.routing.adapter,
      expected.confidence === "Unavailable" ? null : expected.provider,
      expected.prompt
    );
    assert.ok(response.metadata.routing.selectionReason, expected.prompt);
    assert.ok(Array.isArray(response.metadata.routing.discardedProviders), expected.prompt);
  }
});

test("Web never falls back to OpenAI when Trusted Web Tool is unavailable", async () => {
  const { runtime, events } = createMatrixRuntime();
  const response = await runTrustedAssistantRuntime({ prompt: "¿Quién es el Papa?" }, runtime);

  assert.equal(response.provider, "web-tool");
  assert.equal(response.confidence, "Unavailable");
  assert.equal(response.metadata.routing.fallback, "unavailable-no-fallback");
  assert.ok(response.metadata.routing.discardedProviders.some((provider) => provider.id === "openai"));
  assert.ok(events.some((event) => event.type === "provider.selection" && event.selectedProvider === null));
});

test("Routing observability explains the chosen and discarded providers without recording prompts", async () => {
  const { runtime, events } = createMatrixRuntime();
  const response = await runTrustedAssistantRuntime({ prompt: "Explícame React." }, runtime);
  const selection = events.find((event) => event.type === "provider.selection" && event.requestId === response.metadata.routing.requestId);
  const completed = events.find((event) => event.type === "assistant.completed" && event.requestId === response.metadata.routing.requestId);

  assert.equal(selection.selectedProvider, "codex");
  assert.equal(selection.classification, "Coding");
  assert.ok(selection.discardedProviders.some((provider) => provider.id === "openai"));
  assert.equal(completed.confidence, "Estimated");
  assert.equal(JSON.stringify(events).includes("Explícame React"), false);
});
