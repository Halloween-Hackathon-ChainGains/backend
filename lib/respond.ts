import { allAccepted, confirmLoop, getLoops, withSeedDecisions } from "./match";
import { addDeclined, bumpVersion, getDecisions, setDecision, type Decision, type Meeting } from "./store";

export type RespondResult =
  | { ok: true; body: { status: "declined" } | { status: "confirmed"; meeting: Meeting } | { status: "pending"; decisions: Record<string, Decision> } }
  | { ok: false; status: number; error: string };

export async function respond(loopId: string, personId: string, decision: Decision): Promise<RespondResult> {
  const { loops, people } = await getLoops();
  const loop = loops.find((candidate) => candidate.id === loopId);
  if (!loop) return { ok: false, status: 404, error: "Loop not found" };
  if (!loop.people.includes(personId)) return { ok: false, status: 403, error: "Person is not in this loop" };

  if (loop.status === "confirmed" && loop.meeting) {
    if (decision === "no") return { ok: false, status: 409, error: "Loop is already confirmed" };
    return { ok: true, body: { status: "confirmed", meeting: loop.meeting } };
  }

  await setDecision(loopId, personId, decision);
  if (decision === "no") {
    await addDeclined(loopId);
    await bumpVersion();
    return { ok: true, body: { status: "declined" } };
  }

  const decisions = withSeedDecisions(loop, await getDecisions(loopId));
  if (allAccepted(loop, decisions)) {
    const meeting = await confirmLoop({ ...loop }, people);
    await bumpVersion();
    return { ok: true, body: { status: "confirmed", meeting } };
  }
  await bumpVersion();
  return { ok: true, body: { status: "pending", decisions } };
}
