// AI providers for Sift.
// Primary: Meterless Runtime (OpenAI-compatible contract, provider contract v4).
// Fallback for hosted demos where no Nightshift hotspot is reachable: NVIDIA NIM direct.
// The agent pipeline is identical either way; the provider is selectable in Settings.

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ProviderStatus {
  state: "online" | "unauthorized" | "offline" | "unconfigured";
  models?: string[]; detail?: string;
}

// --- Meterless Runtime contract helpers -------------------------------------
// Normalise any pasted URL to <host>/v1. Never produce /v1/v1.
export function normalizeMeterlessBase(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/v1(\/chat\/completions|\/models|\/healthz)?$/i, "");
  return `${u}/v1`;
}

export interface MeterlessConfig { baseUrl: string; token: string; model: string }

export async function meterlessStatus(cfg: MeterlessConfig): Promise<ProviderStatus> {
  if (!cfg.baseUrl) return { state: "unconfigured" };
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.token}`, "meterless-app": "sift", "meterless-scope": "user" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return { state: "unauthorized", detail: "Token refused" };
    if (!res.ok) return { state: "offline", detail: `HTTP ${res.status}` };
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data.map((m: { id?: string }) => m.id).filter(Boolean) : [];
    return { state: "online", models };
  } catch (e) {
    return { state: "offline", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function meterlessChat(cfg: MeterlessConfig, messages: ChatMessage[], opts?: { model?: string; temperature?: number }): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      "meterless-app": "sift",
      "meterless-scope": "user",
    },
    body: JSON.stringify({
      model: opts?.model ?? cfg.model ?? "meterless/auto",
      messages,
      temperature: opts?.temperature ?? 0.2,
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000), // a cold model load can take minutes
  });
  if (!res.ok) throw new Error(`Meterless runtime: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200)).catch(() => "")}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// --- NVIDIA NIM direct (hosted fallback; same OpenAI-compatible shape) -------
export interface NvidiaConfig { apiKey: string; model: string; baseUrl?: string }

export async function nvidiaChat(cfg: NvidiaConfig, messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
  const base = cfg.baseUrl ?? "https://integrate.api.nvidia.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? 2048,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`NVIDIA NIM: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// --- unified entry point -----------------------------------------------------
export type ProviderKind = "meterless" | "nvidia";
export interface RuntimeConfig {
  provider: ProviderKind;
  meterless: MeterlessConfig;
  nvidia: NvidiaConfig & { modelDeep?: string };
}

export async function agentChat(cfg: RuntimeConfig, messages: ChatMessage[], lane: "fast" | "deep" = "fast"): Promise<string> {
  if (cfg.provider === "meterless") {
    const model = lane === "deep" ? "meterless/deep" : "meterless/fast";
    try {
      return await meterlessChat(cfg.meterless, messages, { model });
    } catch (e) {
      // A hosted demo cannot reach a laptop hotspot; fall through to the same
      // configured hosted OpenAI-compatible lane so the product still runs.
      if (!cfg.nvidia.apiKey) throw e;
    }
  }
  const model = lane === "deep" ? cfg.nvidia.modelDeep ?? cfg.nvidia.model : cfg.nvidia.model;
  return nvidiaChat(cfg.nvidia, messages, { maxTokens: lane === "deep" ? 1200 : 800 });
}

export function runtimeConfigFromEnv(): RuntimeConfig {
  return {
    provider: (process.env.SIFT_PROVIDER as ProviderKind) || "nvidia",
    meterless: {
      baseUrl: process.env.METERLESS_BASE_URL ? normalizeMeterlessBase(process.env.METERLESS_BASE_URL) : "",
      token: process.env.METERLESS_RUNTIME_TOKEN ?? "",
      model: process.env.METERLESS_MODEL ?? "meterless/auto",
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY ?? "",
      baseUrl: process.env.NVIDIA_BASE_URL || undefined,
      model: process.env.NVIDIA_MODEL_FAST ?? "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      modelDeep: process.env.NVIDIA_MODEL_DEEP ?? "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    },
  };
}
