import { getLoops } from "../../../lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await getLoops();
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Request failed";
    return Response.json({ error: text }, { status: 500 });
  }
}
