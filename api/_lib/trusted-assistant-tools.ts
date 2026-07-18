import { createServerProviderRuntime } from "./server-provider-runtime.js";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  body: string;
};

type ModelResponderOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createServerAssistantDiagnostics() {
  const development = process.env.NODE_ENV !== "production";
  return {
    development,
    diagnostics: development
      ? {
          log(event: Record<string, unknown>) {
            const logger = event.type === "assistant.failed" ? console.error : console.debug;
            logger("[TrustedAssistantRuntime]", event);
          }
        }
      : undefined
  };
}

export function createServerDateTimeTool(
  profile?: {
    timezone?: string | null;
    locale?: string | null;
    timezoneSource?: "profile" | "browser";
  } | null
) {
  return {
    async getCurrentDateTime() {
      const now = new Date();
      const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      let timezone = systemTimezone;
      let timezoneSource: "profile" | "browser" | "system" = "system";
      if (typeof profile?.timezone === "string" && profile.timezone.trim()) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: profile.timezone.trim() }).format(now);
          timezone = profile.timezone.trim();
          timezoneSource = profile.timezoneSource ?? "profile";
        } catch {
          // Invalid client context falls back to the secure server timezone.
        }
      }

      let locale = typeof profile?.locale === "string" && profile.locale.trim() ? profile.locale.trim() : "es-CO";
      try {
        new Intl.DateTimeFormat(locale).format(now);
      } catch {
        locale = "es-CO";
      }
      const resolvedAt = now.toISOString();
      return {
        iso: resolvedAt,
        resolvedAt,
        timezone,
        timezoneSource,
        locale,
        localDate: now.toLocaleDateString(locale, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: timezone
        }),
        localTime: now.toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: timezone
        }),
        dayOfWeek: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: timezone }).format(now),
        monthName: new Intl.DateTimeFormat(locale, { month: "long", timeZone: timezone }).format(now),
        year: Number(new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: timezone }).format(now)),
        month: Number(new Intl.DateTimeFormat("en-CA", { month: "2-digit", timeZone: timezone }).format(now)),
        day: Number(new Intl.DateTimeFormat("en-CA", { day: "2-digit", timeZone: timezone }).format(now))
      };
    }
  };
}

export function createUnavailableWorkspaceTool() {
  return { async getCurrentWorkspaceContext() { return null; } };
}

export function createUnavailableIdentityTool() {
  return { async getCurrentIdentityContext() { return null; } };
}

export function createServerSystemTool() {
  return {
    async getCurrentSystemContext() {
      return {
        platform: process.platform,
        architecture: process.arch,
        workingDirectory: process.cwd(),
        runtimeVersion: process.version
      };
    }
  };
}

export function createFutureUnavailableTool() {
  return { isAvailable() { return false; } };
}

// Backward-compatible application port. Provider access still goes through ProviderRuntime.
export function createServerModelResponder(options: ModelResponderOptions = {}) {
  const providerRuntime = createServerProviderRuntime(options);
  return {
    async respond(input: { prompt: string; history?: ChatMessage[] }) {
      const result = await providerRuntime.execute({
        operation: "chat",
        capability: "chat",
        timeoutMs: options.timeoutMs,
        input
      });
      return { output: result.output ?? "", provider: result.provider };
    }
  };
}
