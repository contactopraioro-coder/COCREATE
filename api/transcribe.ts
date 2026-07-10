type ApiRequest = {
  method?: string;
  body?: any;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

const defaultTranscribeModel = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openAiKey) {
      throw new Error("La transcripcion de voz en web requiere `OPENAI_API_KEY` en Vercel.");
    }

    const audioBase64 = typeof request.body?.audioBase64 === "string" ? request.body.audioBase64 : "";
    const mimeType = typeof request.body?.mimeType === "string" ? request.body.mimeType : "audio/webm";
    const language = typeof request.body?.language === "string" ? request.body.language : "es";

    const bytes = Buffer.from(audioBase64, "base64");
    const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
    const formData = new FormData();
    formData.append("model", defaultTranscribeModel);
    formData.append("language", language);
    formData.append("file", new Blob([bytes], { type: mimeType }), `voice-note.${extension}`);

    const aiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`
      },
      body: formData
    });

    const payload = await aiResponse.json().catch(() => null);
    if (!aiResponse.ok) {
      throw new Error(payload?.error?.message ?? "OpenAI no pudo transcribir el audio.");
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) {
      throw new Error("La transcripcion llego vacia.");
    }

    response.status(200).json({
      ok: true,
      text,
      provider: "openai"
    });
  } catch (cause) {
    response.status(500).json({
      error: cause instanceof Error ? cause.message : "No pude transcribir la nota de voz."
    });
  }
}
