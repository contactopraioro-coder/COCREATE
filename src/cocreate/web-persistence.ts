export type WebAppId = "v01" | "workbench";

type PersistedStateResponse<TSnapshot> = {
  ok: boolean;
  enabled: boolean;
  snapshot: TSnapshot | null;
  memorySummary: string;
};

const clientStorageKey = "cocreate-client-id";

function createId() {
  return crypto.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getWebClientId() {
  const existing = window.localStorage.getItem(clientStorageKey);
  if (existing) {
    return existing;
  }

  const next = createId();
  window.localStorage.setItem(clientStorageKey, next);
  return next;
}

export async function loadWebState<TSnapshot>(app: WebAppId, clientId: string) {
  const query = new URLSearchParams({
    app,
    clientId
  });

  const response = await fetch(`/api/state?${query.toString()}`);
  const payload = (await response.json().catch(() => null)) as PersistedStateResponse<TSnapshot> | null;

  if (!response.ok || !payload) {
    throw new Error(payload && "error" in payload ? String((payload as { error?: string }).error) : "No pude cargar la sesión web.");
  }

  return payload;
}

export async function saveWebState<TSnapshot>(app: WebAppId, clientId: string, snapshot: TSnapshot) {
  const response = await fetch("/api/state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      app,
      clientId,
      snapshot
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "No pude guardar la sesión web.");
  }

  return payload as { ok: boolean; enabled: boolean; updatedAt?: string };
}
