import { resetLive } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await resetLive();
    return Response.json({ ok: true });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Request failed";
    return Response.json({ error: text }, { status: 500 });
  }
}
