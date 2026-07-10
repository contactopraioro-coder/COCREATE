import { transcribeAudio } from "../server/assistant";

type ApiRequest = {
  method?: string;
  body?: any;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const result = await transcribeAudio({
      audioBase64: typeof request.body?.audioBase64 === "string" ? request.body.audioBase64 : "",
      mimeType: typeof request.body?.mimeType === "string" ? request.body.mimeType : "audio/webm",
      language: typeof request.body?.language === "string" ? request.body.language : "es"
    });

    response.status(200).json(result);
  } catch (cause) {
    response.status(500).json({
      error: cause instanceof Error ? cause.message : "No pude transcribir la nota de voz."
    });
  }
}
