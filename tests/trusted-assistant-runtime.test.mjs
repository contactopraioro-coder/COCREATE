import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAssistantIntent, runTrustedAssistantRuntime } from "../shared/trusted-assistant-runtime.js";
import {
  ProviderRegistry,
  ProviderRuntime,
  ProviderSelection,
  createFunctionProviderAdapter
} from "../shared/provider-runtime.js";

test("Attachments route the next Turn through the model instead of a local tool", () => {
  const intent = analyzeAssistantIntent({
    prompt: "¿Qué hora es según este archivo?",
    origin: "web-renderer",
    attachments: [{ token: "web-token" }]
  });
  assert.equal(intent.primaryCapability, "model");
  assert.equal(intent.providerCapability, "chat");
  assert.ok(intent.routingSignals.includes("model:attachments"));
  assert.ok(intent.routingSignals.includes("provider:web-attachment-gateway"));

  const desktopIntent = analyzeAssistantIntent({
    prompt: "Revisa este archivo TypeScript",
    origin: "desktop-renderer",
    attachments: [{ token: "desktop-token" }]
  });
  assert.equal(desktopIntent.providerCapability, "coding");
});

function createFakeRuntime(overrides = {}) {
  const legacy = {
    dateTimeTool: {
      async getCurrentDateTime() {
        return {
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
        };
      }
    },
    workspaceTool: {
      async getCurrentWorkspaceContext() {
        return {
          workspace: { name: "Workspace personal" },
          project: { name: "CoCreate" },
          task: { title: "Trusted Assistant Runtime" },
          conversation: { title: "Prompt #3" }
        };
      }
    },
    identityTool: {
      async getCurrentIdentityContext() {
        return {
          identity: { id: "identity_1", displayName: "Local User" },
          profile: { displayName: "Martin", timezone: "America/Bogota", locale: "es-CO" },
          device: { platform: "darwin", architecture: "arm64" }
        };
      }
    },
    systemTool: {
      async getCurrentSystemContext() {
        return {
          platform: "darwin",
          architecture: "arm64"
        };
      }
    },
    futureWebTool: {
      isAvailable() {
        return false;
      }
    },
    futureMemoryTool: {
      isAvailable() {
        return false;
      }
    },
    modelResponder: {
      async respond() {
        return {
          output: "Respuesta del modelo",
          provider: "model-test"
        };
      }
    },
    ...overrides
  };
  const registry = new ProviderRegistry();
  const registerTool = (id, domain, query) => {
    registry.register(createFunctionProviderAdapter({
      id,
      capabilities: {
        operations: ["query"],
        domains: [domain],
        streaming: false,
        tools: false,
        reasoning: false,
        multimodal: false,
        embeddings: false
      },
      async execute() {
        return { value: await query() };
      }
    }));
  };
  registerTool("datetime-tool", "datetime", () => legacy.dateTimeTool.getCurrentDateTime());
  registerTool("workspace-tool", "workspace", () => legacy.workspaceTool.getCurrentWorkspaceContext());
  registerTool("identity-tool", "identity", () => legacy.identityTool.getCurrentIdentityContext());
  registerTool("system-tool", "system", () => legacy.systemTool.getCurrentSystemContext());
  registry.register(createFunctionProviderAdapter({
    id: "model-test",
    capabilities: {
      operations: ["chat"],
      domains: ["chat", "coding"],
      streaming: false,
      tools: false,
      reasoning: true,
      multimodal: false,
      embeddings: false
    },
    async execute(request) {
      return legacy.modelResponder.respond(request.input);
    }
  }));
  if (legacy.trustedWebAnswer) {
    registry.register(createFunctionProviderAdapter({
      id: "web-tool",
      capabilities: {
        operations: ["search"],
        domains: ["web"],
        streaming: false,
        tools: true,
        reasoning: false,
        multimodal: false,
        embeddings: false
      },
      async execute(request) {
        const value = typeof legacy.trustedWebAnswer === "function"
          ? await legacy.trustedWebAnswer(request)
          : legacy.trustedWebAnswer;
        return { output: value.output, value };
      }
    }));
  }
  return {
    providerRuntime: new ProviderRuntime({
      registry,
      selection: new ProviderSelection({
        chat: ["model-test"],
        coding: ["model-test"]
      }),
      observer: () => undefined
    }),
    development: legacy.development,
    diagnostics: legacy.diagnostics
  };
}

test("Trusted Assistant Runtime answers verified date questions with tool data", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Qué fecha es hoy?"
    },
    createFakeRuntime()
  );

  assert.equal(result.confidence, "Verified");
  assert.equal(result.capability, "datetime");
  assert.match(result.output, /16 de julio de 2026/i);
});

test("Trusted Assistant Runtime answers verified time questions with tool data", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Qué hora es?"
    },
    createFakeRuntime()
  );

  assert.equal(result.confidence, "Verified");
  assert.equal(result.capability, "datetime");
  assert.match(result.output, /10:00:00/);
  assert.doesNotMatch(result.output, /\.\.$/);
});

test("DateTime intent recognizes Spanish, English, accents and common spelling variants", () => {
  const prompts = [
    "¿Qué día es hoy?",
    "que dia es hoy",
    "¿Qué fecha es hoy?",
    "¿Cuál es la fecha actual?",
    "¿Qué hora es?",
    "¿Qué hora es ahora?",
    "¿Qué día de la semana es?",
    "¿En qué mes estamos?",
    "¿En qué año estamos?",
    "¿Cuál es mi zona horaria?",
    "¿Qué fecha y hora es?",
    "What date is it today?",
    "What time is it?"
  ];

  for (const prompt of prompts) {
    const intent = analyzeAssistantIntent({ prompt });
    assert.equal(intent.primaryCapability, "datetime", prompt);
    assert.equal(intent.requiresCurrentVerification, false, prompt);
    assert.ok(intent.routingSignals.some((signal) => signal.startsWith("datetime:")), prompt);
  }
});

test("External current information routes to web without capturing local DateTime", () => {
  const prompts = [
    "¿Qué noticias hay hoy?",
    "¿Qué ocurrió hoy en Medellín?",
    "¿Quién ganó hoy?",
    "¿Cuál es el precio actual de Bitcoin?",
    "¿Quién es actualmente el alcalde de Medellín?",
    "¿Cuál es la última versión estable de Node.js?"
  ];

  for (const prompt of prompts) {
    const intent = analyzeAssistantIntent({ prompt });
    assert.equal(intent.primaryCapability, "web", prompt);
    assert.equal(intent.requiresCurrentVerification, true, prompt);
    assert.equal(intent.asksDateTime, false, prompt);
  }
});

test("DateTime explanations remain model conversations while bare current markers use DateTime", () => {
  const prompts = [
    "¿Qué es una zona horaria?",
    "Explícame cómo funciona una zona horaria.",
    "Explícame por qué existen los años bisiestos."
  ];

  for (const prompt of prompts) {
    const intent = analyzeAssistantIntent({ prompt });
    assert.equal(intent.primaryCapability, "model", prompt);
    assert.equal(intent.requiresCurrentVerification, false, prompt);
  }

  for (const prompt of ["hoy", "ahora", "zona horaria", "hora local"]) {
    assert.equal(analyzeAssistantIntent({ prompt }).primaryCapability, "datetime", prompt);
  }
});

test("Local deterministic capabilities take priority over current markers and web", async () => {
  let webChecks = 0;
  const runtime = createFakeRuntime({
    futureWebTool: {
      isAvailable() {
        webChecks += 1;
        return false;
      }
    }
  });
  const cases = [
    ["¿Qué día es hoy?", "datetime"],
    ["¿Quién soy actualmente?", "identity"],
    ["¿Qué proyecto tengo abierto hoy?", "workspace"]
  ];

  for (const [prompt, capability] of cases) {
    const result = await runTrustedAssistantRuntime({ prompt }, runtime);
    assert.equal(result.capability, capability, prompt);
    assert.notEqual(result.provider, "future-web-tool", prompt);
  }
  assert.equal(webChecks, 0);
});

test("DateTime responses include verified tool, timezone and resolution metadata", async () => {
  const result = await runTrustedAssistantRuntime({ prompt: "que dia es hoy" }, createFakeRuntime());

  assert.equal(result.confidence, "Verified");
  assert.equal(result.metadata.tool, "DateTimeTool");
  assert.equal(result.metadata.timezone, "America/Bogota");
  assert.equal(result.metadata.resolvedAt, "2026-07-16T15:00:00.000Z");
});

test("Trusted Assistant Runtime answers workspace questions from workspace context", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Qué proyecto tengo abierto?"
    },
    createFakeRuntime()
  );

  assert.equal(result.confidence, "Verified");
  assert.equal(result.capability, "workspace");
  assert.match(result.output, /CoCreate/);
});

test("Trusted Assistant Runtime answers identity questions from identity context", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Quién soy en CoCreate?"
    },
    createFakeRuntime()
  );

  assert.equal(result.confidence, "Verified");
  assert.equal(result.capability, "identity");
  assert.match(result.output, /Martin/);
});

test("Trusted Assistant Runtime refuses current-info questions without web tool", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Quién es el presidente de Colombia hoy?"
    },
    createFakeRuntime()
  );

  assert.equal(result.confidence, "Unavailable");
  assert.equal(result.capability, "web");
  assert.match(result.output, /proveedor disponible|evidencia pública verificable/i);
});

test("Trusted Assistant Runtime accepts current facts only with grounded citations", async () => {
  const retrievedAt = "2026-07-16T15:00:00.000Z";
  let providerInput = null;
  const result = await runTrustedAssistantRuntime({
    prompt: "¿Quién es actualmente el alcalde de Medellín?",
    history: [{ role: "user", body: "private workspace context" }],
    context: { locale: "es-CO", timezone: "America/Bogota", countryHint: "CO" }
  }, createFakeRuntime({
    trustedWebAnswer(request) {
      providerInput = request.input;
      return {
        output: "La fuente institucional identifica a Example Person.",
        confidence: "Verified",
        grounded: true,
        verifiedAt: retrievedAt,
        sources: [{ id: "official", title: "Alcaldía", url: "https://example.gov/mayor", domain: "example.gov", retrievedAt }],
        citations: [{ id: "citation-official", sourceId: "official", title: "Alcaldía", url: "https://example.gov/mayor", domain: "example.gov", retrievedAt, claimIds: ["evidence-official"] }],
        warnings: [],
        provider: "test-search",
        groundingBundle: { conflicts: [] },
        metadata: { searchesCount: 1, fetchesCount: 1 }
      };
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.confidence, "Verified");
  assert.equal(result.tool, "TrustedWebTool");
  assert.equal(result.citations.length, 1);
  assert.equal(result.verifiedAt, retrievedAt);
  assert.equal("history" in providerInput, false);
  assert.equal(JSON.stringify(providerInput).includes("private workspace context"), false);
});

test("Trusted Assistant Runtime rejects a fabricated Verified response without evidence", async () => {
  const result = await runTrustedAssistantRuntime({ prompt: "¿Quién es el presidente actual?" }, createFakeRuntime({
    trustedWebAnswer: {
      output: "Una afirmación actual sin fuentes.",
      confidence: "Verified",
      grounded: false,
      sources: [],
      citations: [],
      warnings: []
    }
  }));
  assert.equal(result.ok, false);
  assert.equal(result.confidence, "InsufficientEvidence");
  assert.equal(result.citations.length, 0);
  assert.doesNotMatch(result.output, /afirmación actual sin fuentes/i);
});

test("Trusted Assistant Runtime delegates general prompts to model responder with estimated confidence", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "Ayúdame a depurar este error de React"
    },
    createFakeRuntime()
  );

  assert.equal(result.confidence, "Estimated");
  assert.equal(result.capability, "model");
  assert.equal(result.output, "Respuesta del modelo");
});

test("Live and Proposal provider envelopes allow bounded long-running Codex turns", async () => {
  const observed = [];
  const runtime = {
    providerRuntime: {
      async execute(request) {
        observed.push({ interactionMode: request.input.interactionMode, timeoutMs: request.timeoutMs });
        return { output: "ok", provider: "model-test", routing: null };
      }
    }
  };

  await runTrustedAssistantRuntime({ prompt: "Implementa el cambio", interactionMode: "proposal" }, runtime);
  await runTrustedAssistantRuntime({ prompt: "Analiza el proyecto", interactionMode: "live" }, runtime);
  await runTrustedAssistantRuntime({ prompt: "Hola", interactionMode: "chat" }, runtime);

  assert.deepEqual(observed, [
    { interactionMode: "proposal", timeoutMs: 600_000 },
    { interactionMode: "live", timeoutMs: 600_000 },
    { interactionMode: "chat", timeoutMs: undefined }
  ]);
});

test("Trusted Assistant Runtime handles a simple conversation through the model", async () => {
  let receivedPrompt = "";
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "hola"
    },
    createFakeRuntime({
      modelResponder: {
        async respond(input) {
          receivedPrompt = input.prompt;
          return {
            output: "Hola, ¿en qué te ayudo?",
            provider: "model-test"
          };
        }
      }
    })
  );

  assert.equal(receivedPrompt, "hola");
  assert.equal(result.ok, true);
  assert.equal(result.capability, "model");
  assert.equal(result.provider, "model-test");
  assert.match(result.output, /^Hola/);
});

test("Trusted Assistant Runtime routes TypeScript help to the model", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "ayúdame a escribir una función en TypeScript"
    },
    createFakeRuntime()
  );

  assert.equal(result.ok, true);
  assert.equal(result.capability, "model");
  assert.equal(result.confidence, "Estimated");
});

test("Trusted Assistant Runtime normalizes model failures and preserves development diagnostics", async () => {
  const events = [];
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "hola"
    },
    createFakeRuntime({
      development: true,
      diagnostics: {
        log(event) {
          events.push(event);
        }
      },
      modelResponder: {
        async respond() {
          throw new Error("provider connection refused");
        }
      }
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.confidence, "Unavailable");
  assert.match(result.output, /provider connection refused/);
  assert.equal(result.metadata.error.message, "provider connection refused");
  assert.ok(events.some((event) => event.type === "assistant.routing" && event.capability === "model"));
  assert.ok(events.some((event) => event.type === "assistant.failed" && event.error.stack));
});

test("Trusted Assistant Runtime rejects an empty model response", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "hola"
    },
    createFakeRuntime({
      modelResponder: {
        async respond() {
          return {
            output: "   ",
            provider: "model-test"
          };
        }
      }
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.confidence, "Unavailable");
  assert.equal(result.metadata.errorCode, "MODEL_EMPTY_RESPONSE");
  assert.match(result.output, /no devolvió texto útil/i);
});

test("Trusted Assistant Runtime reports tool failure without inventing data", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Qué hora es?"
    },
    createFakeRuntime({
      dateTimeTool: {
        async getCurrentDateTime() {
          return null;
        }
      }
    })
  );

  assert.equal(result.confidence, "Unavailable");
  assert.equal(result.capability, "datetime");
  assert.match(result.output, /no pude consultar la fecha y hora/i);
});

test("Trusted Assistant Runtime normalizes a thrown tool failure", async () => {
  const result = await runTrustedAssistantRuntime(
    {
      prompt: "¿Qué fecha es hoy?"
    },
    createFakeRuntime({
      dateTimeTool: {
        async getCurrentDateTime() {
          throw new Error("clock unavailable");
        }
      }
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.confidence, "Unavailable");
  assert.equal(result.provider, "datetime-tool");
  assert.doesNotMatch(result.output, /clock unavailable/);
});
