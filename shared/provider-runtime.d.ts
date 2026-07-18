export type ProviderHealthStatus = "Healthy" | "Unavailable" | "Misconfigured" | "Rate Limited" | "Maintenance";
export type ProviderOperation = "chat" | "completion" | "transcription" | "embeddings" | string;

export type ProviderCapabilities = {
  operations: ProviderOperation[];
  domains: string[];
  streaming: boolean;
  tools: boolean;
  reasoning: boolean;
  multimodal: boolean;
  embeddings: boolean;
};

export type ProviderHealth = {
  status: ProviderHealthStatus;
  checkedAt?: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  routing?: ProviderRoutingDecision;
};

export type ProviderRoutingDecision = {
  requestId: string;
  intent: string | null;
  capability: string;
  providerCapability: string;
  classification: string | null;
  expectedConfidence: string | null;
  tool: string | null;
  requiredProvider: string | null;
  selectedProvider: string | null;
  selectedAdapter: string | null;
  discardedProviders: Array<{ id: string; reason: string; health: ProviderHealthStatus }>;
  selectionReason: string;
  fallback: boolean;
  fallbackPolicy: string;
};

export type ProviderRequest = {
  operation: ProviderOperation;
  capability: string;
  provider?: string;
  requestId?: string;
  timeoutMs?: number;
  input?: any;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type ProviderResult = {
  provider: string;
  requestId: string;
  output?: string;
  value?: any;
  model?: string | null;
  usage?: Record<string, number> | null;
  metadata?: Record<string, unknown>;
  routing?: ProviderRoutingDecision;
};

export interface ProviderAdapter {
  id: string;
  name?: string;
  enabled?: boolean;
  capabilities: ProviderCapabilities;
  metadata?: Record<string, unknown>;
  getHealth?: () => Promise<ProviderHealth> | ProviderHealth;
  execute: (request: ProviderRequest) => Promise<Omit<ProviderResult, "provider" | "requestId">> | Omit<ProviderResult, "provider" | "requestId">;
  stream?: (request: ProviderRequest) => AsyncIterable<unknown>;
}

export type ProviderDescriptor = {
  id: string;
  name: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  metadata: Record<string, unknown>;
  health: ProviderHealth;
};

export type ProviderError = Error & {
  code: string;
  provider: string;
  kind: string;
  health: ProviderHealthStatus;
  safeMessage: string;
  retriable: boolean;
  requestId: string | null;
  status: number | null;
  routing: ProviderRoutingDecision | null;
};

export declare function createProviderError(code: string, message: string, options?: Record<string, any>): ProviderError;
export declare function normalizeProviderError(error: unknown, context?: Record<string, any>): {
  code: string;
  provider: string;
  kind: string;
  health: ProviderHealthStatus;
  message: string;
  safeMessage: string;
  retriable: boolean;
  requestId: string | null;
  status: number | null;
  routing: ProviderRoutingDecision | null;
};

export declare class ProviderRegistry {
  constructor(adapters?: ProviderAdapter[]);
  register(adapter: ProviderAdapter): ProviderAdapter;
  get(id: string): ProviderAdapter | null;
  list(): Array<Omit<ProviderDescriptor, "health">>;
  getHealth(id: string): Promise<ProviderHealth>;
  describe(): Promise<ProviderDescriptor[]>;
}

export declare class ProviderSelection {
  constructor(priorities?: Record<string, string[]>);
  evaluate(request: ProviderRequest, providers: ProviderDescriptor[]): {
    selected: ProviderDescriptor | null;
    considered: Array<{ id: string; health: ProviderHealthStatus; eligible: boolean; reason: string }>;
    priority: string[];
    requiredProvider: string | null;
    domain: string;
    operation: string;
    selectionReason: string;
    fallback: boolean;
  };
  select(request: ProviderRequest, providers: ProviderDescriptor[]): ProviderDescriptor | null;
}

export declare class ProviderMetrics {
  constructor(limit?: number);
  record(entry: Record<string, any>): Record<string, any>;
  list(): Array<Record<string, any>>;
}

export declare class ProviderRuntime {
  constructor(options?: {
    registry?: ProviderRegistry;
    selection?: ProviderSelection;
    metrics?: ProviderMetrics;
    timeoutMs?: number;
    observer?: (event: Record<string, unknown>) => void;
  });
  registry: ProviderRegistry;
  select(request: ProviderRequest): Promise<ProviderAdapter>;
  execute(request: ProviderRequest): Promise<ProviderResult>;
  stream(request: ProviderRequest): AsyncIterable<unknown>;
  getProviders(): Promise<ProviderDescriptor[]>;
  getMetrics(): Array<Record<string, any>>;
}

export declare class ProviderFactory {
  register(id: string, factory: (options?: any) => ProviderAdapter): this;
  create(id: string, options?: any): ProviderAdapter;
}

export declare function createFunctionProviderAdapter(options: Partial<ProviderAdapter> & Pick<ProviderAdapter, "id" | "capabilities" | "execute">): ProviderAdapter;
export declare function createPlaceholderProvider(options: {
  id: string;
  name?: string;
  capabilities: ProviderCapabilities;
  metadata?: Record<string, unknown>;
}): ProviderAdapter;

export declare const PROVIDER_HEALTH_STATES: Set<ProviderHealthStatus>;
