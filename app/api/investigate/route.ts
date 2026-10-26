import { investigate } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { question } = await req.json();
  if (!question || typeof question !== "string" || question.length > 2000) {
    return Response.json({ error: "question required (<=2000 chars)" }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await investigate(question, send);
      } catch (err) {
        send({ type: "error", data: String(err).slice(0, 400) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
