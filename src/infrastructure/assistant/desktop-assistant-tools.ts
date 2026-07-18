import type { IdentityService } from "../../app/services/identity-service.js";
import type { WorkspaceRuntimeService } from "../../app/services/workspace-runtime-service.js";
import type {
  DateTimeTool,
  FutureMemoryTool,
  IdentityTool,
  SystemTool,
  WorkspaceTool
} from "./assistant-tools.js";

function resolveTimezone(timezone?: string | null) {
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (typeof timezone === "string" && timezone.trim()) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone.trim() }).format(new Date());
      return { timezone: timezone.trim(), timezoneSource: "profile" as const };
    } catch {
      // Invalid profile values fall back to the runtime timezone.
    }
  }

  return { timezone: systemTimezone, timezoneSource: "system" as const };
}

function resolveLocale(locale?: string | null) {
  const fallback = typeof navigator !== "undefined" && navigator.language ? navigator.language : "es-CO";
  const candidate = typeof locale === "string" && locale.trim() ? locale.trim() : fallback;
  try {
    new Intl.DateTimeFormat(candidate).format(new Date());
    return candidate;
  } catch {
    return "es-CO";
  }
}

function formatDateTime(timezone?: string | null, locale?: string | null) {
  const now = new Date();
  const resolvedTimezone = resolveTimezone(timezone);
  const effectiveLocale = resolveLocale(locale);
  const resolvedAt = now.toISOString();

  return {
    iso: resolvedAt,
    resolvedAt,
    timezone: resolvedTimezone.timezone,
    timezoneSource: resolvedTimezone.timezoneSource,
    locale: effectiveLocale,
    localDate: now.toLocaleDateString(effectiveLocale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: resolvedTimezone.timezone
    }),
    localTime: now.toLocaleTimeString(effectiveLocale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: resolvedTimezone.timezone
    }),
    dayOfWeek: new Intl.DateTimeFormat(effectiveLocale, {
      weekday: "long",
      timeZone: resolvedTimezone.timezone
    }).format(now),
    monthName: new Intl.DateTimeFormat(effectiveLocale, {
      month: "long",
      timeZone: resolvedTimezone.timezone
    }).format(now),
    year: Number(
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        timeZone: resolvedTimezone.timezone
      }).format(now)
    ),
    month: Number(
      new Intl.DateTimeFormat("en-CA", {
        month: "2-digit",
        timeZone: resolvedTimezone.timezone
      }).format(now)
    ),
    day: Number(
      new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        timeZone: resolvedTimezone.timezone
      }).format(now)
    )
  };
}

export function createDesktopAssistantTools(params: {
  identityService: IdentityService;
  workspaceRuntimeService: WorkspaceRuntimeService;
}) {
  const dateTimeTool: DateTimeTool = {
    async getCurrentDateTime() {
      const profile = await params.identityService.getUserProfile();
      return formatDateTime(
        typeof profile?.timezone === "string" ? profile.timezone : null,
        typeof profile?.locale === "string" ? profile.locale : null
      );
    }
  };

  const workspaceTool: WorkspaceTool = {
    async getCurrentWorkspaceContext() {
      const bootstrap = await params.workspaceRuntimeService.getBootstrap();
      if (!bootstrap) {
        return null;
      }

      return {
        workspace: bootstrap.workspace,
        project: bootstrap.project,
        task: bootstrap.task,
        conversation: bootstrap.conversation,
        conversations: bootstrap.conversations
      };
    }
  };

  const identityTool: IdentityTool = {
    async getCurrentIdentityContext() {
      const bootstrap = await params.identityService.getBootstrap();
      if (!bootstrap) {
        return null;
      }

      return bootstrap;
    }
  };

  const systemTool: SystemTool = {
    async getCurrentSystemContext() {
      const bootstrap = await params.identityService.getBootstrap();
      const config = window.overlayBridge
        ? await window.overlayBridge.getConfig().catch(() => null)
        : null;
      return bootstrap?.device
        ? {
            ...bootstrap.device,
            workingDirectory: config?.workingDirectory ?? null,
            appVersion: config?.appVersion ?? null,
            runtimeVersion: config?.runtimeVersion ?? null
          }
        : null;
    }
  };

  const futureMemoryTool: FutureMemoryTool = {
    isAvailable() {
      return false;
    }
  };

  return {
    dateTimeTool,
    workspaceTool,
    identityTool,
    systemTool,
    futureMemoryTool
  };
}
