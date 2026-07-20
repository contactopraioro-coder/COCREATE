// Live-coding "prompt organizer": the LLM-in-the-middle that turns the running
// speech transcript into structured improvement prompts in near real-time.
//
// Each improvement has a short title (the goal) and an actionable body (the edit
// instruction for Codex). The model marks an improvement "complete" once the user
// moved on to another, and "isFollowUp" when they revisit an earlier one — this is
// what lets the renderer dispatch a title's prompt exactly when it's done, and
// thread follow-ups onto the same improvement.

const SYSTEM_PROMPT = [
  "Eres un organizador de intenciones de edición web EN TIEMPO REAL.",
  "Recibes la transcripción hablada (posiblemente parcial) de un usuario que va señalando elementos de su página web y describiendo los cambios que quiere.",
  "Tu trabajo es organizar lo dicho en \"mejoras\" (improvements). Cada mejora tiene:",
  "- title: un título corto que nombra el objetivo de la mejora (p. ej. \"Título principal\", \"Botón de contacto\").",
  "- body: una instrucción concreta, accionable y en imperativo para un agente de código, que integre TODO lo que el usuario pidió sobre esa mejora (incluidos cambios de opinión).",
  "- status: \"complete\" SOLO cuando el usuario claramente terminó de hablar de esa mejora y pasó a otra. La mejora que el usuario describe al final de la transcripción es \"in_progress\".",
  "- isFollowUp: true si el usuario retoma una mejora que ya había mencionado antes (en ese caso el body debe reflejar el estado final combinado).",
  "Mantén títulos ESTABLES: si una mejora ya apareció, reutiliza el mismo título.",
  "No inventes cambios que el usuario no pidió. No incluyas detalles de estilo que no se dijeron.",
  "Devuelve EXCLUSIVAMENTE JSON válido con esta forma:",
  "{\"improvements\":[{\"title\":\"\",\"body\":\"\",\"status\":\"complete|in_progress\",\"isFollowUp\":false}]}"
].join("\n");

function normalizeImprovement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!title || !body) return null;
  return {
    title,
    body,
    status: raw.status === "complete" ? "complete" : "in_progress",
    isFollowUp: raw.isFollowUp === true
  };
}

// Core organizer call, reusable by both the IPC handler and the main-side Live
// session. Returns the current set of titled improvements for the transcript.
export async function organizeTranscript({ apiKey, model, transcript, cursorContext }) {
  const key = (apiKey || "").replace(/﻿/g, "").trim();
  const organizerModel = model || "gpt-4.1-mini";
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) return { improvements: [] };
  if (!key) {
    throw new Error("Falta OPENAI_API_KEY para el organizador de Live coding.");
  }
  const cursor = typeof cursorContext === "string" ? cursorContext.trim() : "";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: organizerModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Contexto de cursor (a qué elementos apunta el usuario): ${cursor || "(no disponible)"}\n\nTranscripción hasta ahora:\n${text}`
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`El organizador de Live coding falló (HTTP ${response.status}). ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { improvements: [] };
  }
  const improvements = Array.isArray(parsed?.improvements)
    ? parsed.improvements.map(normalizeImprovement).filter(Boolean)
    : [];
  return { improvements };
}

const BOUNDARY_SYSTEM_PROMPT = [
  "Eres el analizador de UNA sola tarea de edición web que un usuario describe hablando mientras señala elementos con el cursor.",
  "Recibes la transcripción ACUMULADA de la tarea ACTUAL (una sola mejora).",
  "Devuelve EXCLUSIVAMENTE JSON válido: {\"boundary\": false, \"prompt\": \"\", \"nextSeed\": \"\"}.",
  "- boundary = true SOLO si el usuario indicó EXPLÍCITAMENTE que ya terminó esta mejora o que va a describir una mejora/tarea DIFERENTE.",
  "  Señales explícitas válidas: \"nueva tarea\", \"otra mejora\", \"ahora cambiemos otra cosa\", \"listo con esto\", \"ya terminé con esto\", \"pasemos a otra cosa\", \"siguiente\".",
  "  NUNCA pongas boundary=true por un simple cambio de tema, por dar más detalles, o por corregirse. Requiere una señal EXPLÍCITA de transición. Ante la duda, boundary=false.",
  "- prompt = UNA única instrucción accionable en imperativo para un agente de código que integre TODO lo que el usuario pidió para ESTA mejora (fusionando detalles y correcciones en un solo prompt coherente), EXCLUYENDO cualquier señal de transición. Nunca generes múltiples cambios inconsistentes: es UNA mejora.",
  "- nextSeed = si la señal de transición vino en la misma frase junto con el inicio de la SIGUIENTE mejora, pon aquí SOLO esa parte inicial de la nueva mejora; si no, cadena vacía."
].join("\n");

// Detects whether the user explicitly closed the current task, and consolidates
// everything said into a single actionable prompt. This replaces multi-improvement
// auto-splitting so one objective becomes exactly one prompt.
export async function detectTaskBoundary({ apiKey, model, baseUrl, transcript, cursorContext }) {
  const key = (apiKey || "").replace(/﻿/g, "").trim();
  const organizerModel = model || "gpt-4.1-mini";
  const endpoint = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) return { boundary: false, prompt: "", nextSeed: "" };
  if (!key) throw new Error("Falta la API key del organizador de Live coding.");
  const cursor = typeof cursorContext === "string" ? cursorContext.trim() : "";

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: organizerModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BOUNDARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Contexto de cursor: ${cursor || "(no disponible)"}\n\nTranscripción de la tarea actual:\n${text}`
        }
      ]
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`El analizador de tarea falló (HTTP ${response.status}). ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return {
    boundary: parsed?.boundary === true,
    prompt: typeof parsed?.prompt === "string" ? parsed.prompt.trim() : "",
    nextSeed: typeof parsed?.nextSeed === "string" ? parsed.nextSeed.trim() : ""
  };
}

export function registerLiveOrganizerIpcHandlers({ ipcMain, apiKey, model }) {
  ipcMain.handle("cocreate:live:organize", async (_event, payload) =>
    organizeTranscript({
      apiKey,
      model,
      transcript: payload?.transcript,
      cursorContext: payload?.cursorContext
    })
  );

  return () => {
    ipcMain.removeHandler("cocreate:live:organize");
  };
}
