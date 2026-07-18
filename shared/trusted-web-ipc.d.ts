export declare const TRUSTED_WEB_IPC_CHANNELS: Readonly<{
  getStatus: "trusted-web:get-status";
  execute: "trusted-web:execute";
  cancel: "trusted-web:cancel";
}>;

export type TrustedWebIpcExecuteRequest = {
  requestId: string;
  input: {
    query: string;
    locale?: string;
    timezone?: string;
    countryHint?: string;
    freshness?: "any" | "today" | "week" | "month" | "year";
    intent?: string;
    correlationId?: string;
  };
};

export type TrustedWebIpcCancelRequest = { requestId: string; reason?: string };

export declare function assertTrustedWebExecuteRequest(value: unknown): TrustedWebIpcExecuteRequest;
export declare function assertTrustedWebCancelRequest(value: unknown): TrustedWebIpcCancelRequest;
