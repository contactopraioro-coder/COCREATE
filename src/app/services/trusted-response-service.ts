import { buildTrustedResponse } from "../../../shared/trusted-assistant-runtime.js";

export class TrustedResponseService {
  unavailable(output: string, capability = "model") {
    return buildTrustedResponse({
      ok: false,
      output,
      confidence: "Unavailable",
      capability,
      grounding: ["tooling"],
      provider: "runtime"
    });
  }
}
