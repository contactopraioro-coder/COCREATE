export type GitContext = {
  available: boolean;
  repository: boolean;
  branch?: string | null;
  detached?: boolean;
  commit?: string;
  dirty?: boolean;
  changedFiles?: number;
  location?: string;
  runtimeMode?: string;
  reason?: string;
};

export class GitContextService {
  constructor(private readonly loadFromRuntime?: () => Promise<GitContext>) {}

  async getContext(): Promise<GitContext> {
    if (!this.loadFromRuntime) {
      return { available: false, repository: false, reason: "CoCreate Web no tiene acceso al filesystem ni a branches locales." };
    }
    try {
      return await this.loadFromRuntime();
    } catch {
      return { available: true, repository: false, reason: "No pude consultar el contexto Git de este Project." };
    }
  }
}

