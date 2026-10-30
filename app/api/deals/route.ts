import { getLoops } from "../../../lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { loops } = await getLoops();
    const lines = loops
      .map((loop) => loop.message.replace(/\s+/g, " ").trim())
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
