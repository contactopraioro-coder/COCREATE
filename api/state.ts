type ApiRequest = {
  method?: string;
  url?: string;
  body?: any;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type StateRow = {
  client_id: string;
  app_id: string;
  snapshot: unknown;
  updated_at?: string;
};

type ProfileRow = {
  client_id: string;
  memory_summary?: string | null;
  memory_payload?: unknown;
  updated_at?: string;
};

const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

function isPersistenceEnabled() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function normalizeClientId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function normalizeAppId(value: unknown) {
  if (value === "workbench") {
    return "workbench";
  }

  return "v01";
}

function buildHeaders() {
  return {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json"
  };
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error_description ?? payload?.error ?? "Supabase no pudo procesar la solicitud.");
  }

  return payload;
}

async function fetchSnapshot(clientId: string, appId: string) {
  const query = new URLSearchParams({
    select: "client_id,app_id,snapshot,updated_at",
    client_id: `eq.${clientId}`,
    app_id: `eq.${appId}`,
    limit: "1"
  });

  const payload = (await fetchJson(`${supabaseUrl}/rest/v1/cocreate_snapshots?${query.toString()}`, {
    headers: buildHeaders()
  })) as StateRow[];

  return payload[0] ?? null;
}

async function fetchProfile(clientId: string) {
  const query = new URLSearchParams({
    select: "client_id,memory_summary,memory_payload,updated_at",
    client_id: `eq.${clientId}`,
    limit: "1"
  });

  const payload = (await fetchJson(`${supabaseUrl}/rest/v1/cocreate_profiles?${query.toString()}`, {
    headers: buildHeaders()
  })) as ProfileRow[];

  return payload[0] ?? null;
}

function deriveMemorySeed(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const notes = typeof snapshot.notes === "string" ? snapshot.notes.trim() : "";
  const prompt = typeof snapshot.prompt === "string" ? snapshot.prompt.trim() : "";
  const status = typeof snapshot.status === "string" ? snapshot.status.trim() : "";
  const messages = Array.isArray(snapshot.messages)
    ? snapshot.messages
        .slice(-6)
        .map((message) => (typeof message?.body === "string" ? message.body.trim() : ""))
        .filter(Boolean)
    : [];

  const fragments = [notes, prompt, status, ...messages].filter(Boolean);
  if (!fragments.length) {
    return null;
  }

  return fragments.join("\n").slice(0, 1500);
}

async function upsertSnapshot(clientId: string, appId: string, snapshot: unknown) {
  await fetchJson(`${supabaseUrl}/rest/v1/cocreate_snapshots?on_conflict=client_id,app_id`, {
    method: "POST",
    headers: {
      ...buildHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify([
      {
        client_id: clientId,
        app_id: appId,
        snapshot,
        updated_at: new Date().toISOString()
      }
    ])
  });

  const memorySeed = deriveMemorySeed(snapshot);
  if (!memorySeed) {
    return;
  }

  await fetchJson(`${supabaseUrl}/rest/v1/cocreate_profiles?on_conflict=client_id`, {
    method: "POST",
    headers: {
      ...buildHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify([
      {
        client_id: clientId,
        memory_payload: {
          latestStateSeed: memorySeed
        },
        updated_at: new Date().toISOString()
      }
    ])
  });
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const persistenceEnabled = isPersistenceEnabled();

  if (request.method === "GET") {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const clientId = normalizeClientId(requestUrl.searchParams.get("clientId"));
    const appId = normalizeAppId(requestUrl.searchParams.get("app"));

    if (!clientId) {
      response.status(400).json({ error: "Falta clientId para cargar el estado." });
      return;
    }

    if (!persistenceEnabled) {
      response.status(200).json({
        ok: true,
        enabled: false,
        snapshot: null,
        memorySummary: ""
      });
      return;
    }

    try {
      const [snapshot, profile] = await Promise.all([fetchSnapshot(clientId, appId), fetchProfile(clientId)]);
      response.status(200).json({
        ok: true,
        enabled: true,
        snapshot: snapshot?.snapshot ?? null,
        memorySummary: typeof profile?.memory_summary === "string" ? profile.memory_summary : ""
      });
    } catch (cause) {
      response.status(500).json({
        error: cause instanceof Error ? cause.message : "No pude cargar la sesión persistida."
      });
    }
    return;
  }

  if (request.method === "POST") {
    const clientId = normalizeClientId(request.body?.clientId);
    const appId = normalizeAppId(request.body?.app);
    const snapshot = request.body?.snapshot;

    if (!clientId) {
      response.status(400).json({ error: "Falta clientId para guardar el estado." });
      return;
    }

    if (!snapshot || typeof snapshot !== "object") {
      response.status(400).json({ error: "Falta snapshot para guardar el estado." });
      return;
    }

    if (!persistenceEnabled) {
      response.status(200).json({
        ok: true,
        enabled: false
      });
      return;
    }

    try {
      await upsertSnapshot(clientId, appId, snapshot);
      response.status(200).json({
        ok: true,
        enabled: true,
        updatedAt: new Date().toISOString()
      });
    } catch (cause) {
      response.status(500).json({
        error: cause instanceof Error ? cause.message : "No pude guardar la sesión persistida."
      });
    }
    return;
  }

  response.status(405).json({ error: "Method not allowed" });
}
