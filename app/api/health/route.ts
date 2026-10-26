import { zetarisHealth, zetarisConfigFromEnv } from "@/lib/zetaris";
import { meterlessStatus, runtimeConfigFromEnv } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET() {
  const z = await zetarisHealth(zetarisConfigFromEnv()).catch((e) => ({ ok: false, detail: String(e) }));
  const ai = runtimeConfigFromEnv();
  let meterless = null;
  if (ai.provider === "meterless" && ai.meterless.baseUrl) {
    meterless = await meterlessStatus(ai.meterless).catch((e) => ({ status: "offline", detail: String(e) }));
  }
  return Response.json({ zetaris: z, provider: ai.provider, meterless, nvidiaKeySet: !!ai.nvidia.apiKey });
}
