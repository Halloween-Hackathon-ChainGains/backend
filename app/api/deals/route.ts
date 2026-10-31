import { getLoops } from "../../../lib/match";
import { meetLine } from "../../../lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { loops } = await getLoops();
    const lines = loops
      .map((loop) => {
        const message = loop.message.replace(/\s+/g, " ").trim();
        if (!message || loop.status !== "confirmed" || !loop.meeting) return message;
        return `CONFIRMED: ${message} | ${meetLine(loop.meeting)}`;
      })
      .filter(Boolean);
    const text = lines.length > 0 ? `${lines.join("\n")}\n` : "No deals yet.\n";
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Request failed";
    return Response.json({ error: text }, { status: 500 });
  }
}
