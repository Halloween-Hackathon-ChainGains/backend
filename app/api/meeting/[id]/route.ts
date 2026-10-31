import { toICS } from "../../../../lib/meeting";
import { getConfirmedLoop, getMeeting, getPeople } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const loopId = decodeURIComponent(id).replace(/\.ics$/i, "");
    const [meeting, loop, people] = await Promise.all([getMeeting(loopId), getConfirmedLoop(loopId), getPeople()]);
    if (!meeting || !loop) return Response.json({ error: "Meeting not found" }, { status: 404 });
    return new Response(toICS(loop, people, meeting), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="loop-${loopId}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Request failed";
    return Response.json({ error: text }, { status: 500 });
  }
}
