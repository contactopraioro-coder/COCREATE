import { IntentService } from "./intent-service.js";

export class CapabilityRouter {
  constructor(private readonly intentService = new IntentService()) {}

  resolve(input: { prompt: string; history?: unknown[] }) {
    return this.intentService.analyze(input);
  }
}
