import { generateAssistantReply } from "../server/assistant";

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
    const result = await generateAssistantReply({
      prompt: typeof request.body?.prompt === "string" ? request.body.prompt : "",
      history: Array.isArray(request.body?.history) ? request.body.history : []
    });

    response.status(200).json(result);
  } catch (cause) {
    response.status(500).json({
      error: cause instanceof Error ? cause.message : "No pude responder en CoCreate Web."
    });
  }
}
