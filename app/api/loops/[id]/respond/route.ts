import { respond } from "../../../../../lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const input = (body ?? {}) as { personId?: unknown; decision?: unknown };
    if (typeof input.personId !== "string" || !input.personId) {
      return Response.json({ error: "personId is required" }, { status: 400 });
    }
    if (input.decision !== "yes" && input.decision !== "no") {
      return Response.json({ error: 'decision must be "yes" or "no"' }, { status: 400 });
    }
    const result = await respond(decodeURIComponent(id), input.personId, input.decision);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Request failed";
    return Response.json({ error: text }, { status: 500 });
  }
}
