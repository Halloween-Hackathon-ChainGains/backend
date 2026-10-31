import type { Loop, LoopsResponse, Person, Trade } from "../lib/types";

for (const key of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
  process.env[key] = "";
}

type Libs = typeof import("../lib/match") & typeof import("../lib/store") & typeof import("../lib/respond") & typeof import("../lib/meeting");
let lib: Libs;

async function loadLibs(): Promise<Libs> {
  const [match, store, respond, meeting] = await Promise.all([
    import("../lib/match"),
    import("../lib/store"),
    import("../lib/respond"),
    import("../lib/meeting"),
  ]);
  return { ...match, ...store, ...respond, ...meeting };
}

function fail(label: string, detail: unknown): never {
  console.error(`FAIL ${label}`, detail);
  process.exit(1);
}

function validGoogleUrl(url: string | undefined): boolean {
  if (!url) return false;
  const parsed = new URL(url);
  const dates = parsed.searchParams.get("dates") ?? "";
  const match = dates.match(/^(\d{8}T\d{6}Z)\/(\d{8}T\d{6}Z)$/);
  if (!match) return false;
  const toDate = (stamp: string) =>
    new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);
  const start = toDate(match[1]);
  const minutes = (toDate(match[2]).getTime() - start.getTime()) / 60000;
  const nyTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  return (
    parsed.origin === "https://calendar.google.com" &&
    parsed.pathname === "/calendar/render" &&
    parsed.searchParams.get("action") === "TEMPLATE" &&
    (parsed.searchParams.get("text") ?? "").startsWith("Loop trade: ") &&
    !!parsed.searchParams.get("details") &&
    !!parsed.searchParams.get("location") &&
    minutes === 30 &&
    nyTime === "12:30"
  );
}

function names(loop: Loop, people: Person[]): string[] {
  return loop.people.map((id) => people.find((person) => person.id === id)?.name ?? id).sort();
}

function hasGroup(loops: Loop[], people: Person[], group: string[]): boolean {
  const want = [...group].sort().join(",");
  return loops.some((loop) => names(loop, people).join(",") === want);
}

function stats(people: Person[], loops: Loop[]): LoopsResponse["stats"] {
  return {
    items: loops.reduce((sum, loop) => sum + loop.trades.length, 0),
    dollars: Math.round(loops.reduce((sum, loop) => sum + loop.totalValue, 0)),
    people: people.length,
  };
}

function gives(loop: Loop, people: Person[], fromName: string, toName: string, itemIncludes: string): boolean {
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  return loop.trades.some(
    (trade: Trade) =>
      nameOf.get(trade.from) === fromName &&
      nameOf.get(trade.to) === toName &&
      trade.item.toLowerCase().includes(itemIncludes),
  );
}

async function match(people: Person[]): Promise<Loop[]> {
  const items = people.flatMap((person) => [...person.has, ...person.wants]);
  const { canon, usedFallback } = await lib.canonicalize(items);
  if (usedFallback) console.log("fallback:", true, "labels:", [...canon.entries()]);
  const loops = lib.selectDeals(people, lib.buildEdges(people, canon));
  await lib.fillMessages(loops, people);
  return loops;
}

async function main() {
  lib = await loadLibs();
  const seed = lib.loadSeed();
  const before = await match(seed);
  const beforeStats = stats(seed, before);
  console.log("before", beforeStats);
  for (const loop of before) console.log("-", names(loop, seed).join(", "), "|", loop.message);

  const expected = [
    ["Diego", "Aisha", "Tom", "Kim"],
    ["Jordan", "Sofia", "Arjun", "Mei"],
    ["Priya", "Marcus", "Lena"],
    ["Noah", "Leo", "Hana"],
    ["Ravi", "Chloe"],
  ];
  const unmatched = ["Sam", "Emma", "Zara", "Ben"];
  const missing = expected.filter((group) => !hasGroup(before, seed, group));
  const stray = unmatched.filter((name) => before.some((loop) => names(loop, seed).includes(name)));
  const jordan = before.find((loop) => hasGroup([loop], seed, ["Jordan", "Sofia", "Arjun", "Mei"]));
  if (missing.length || stray.length || before.length !== expected.length) {
    console.error("FAIL seed", { missing, stray, count: before.length });
    process.exit(1);
  }
  if (!jordan?.message.includes("film camera") || !jordan.message.includes("espresso maker")) {
    console.error("FAIL template", jordan?.message);
    process.exit(1);
  }

  const you: Person = { id: "you", name: "You", has: ["Ninja air fryer"], wants: ["microwave"], createdAt: 1 };
  const live = [...seed, you];
  const after = await match(live);
  const afterStats = stats(live, after);
  console.log("after", afterStats);
  for (const loop of after) console.log("-", names(loop, live).join(", "), "|", loop.message);

  const trio = after.find((loop) => hasGroup([loop], live, ["You", "Sam", "Emma"]));
  const still = expected.filter((group) => !hasGroup(after, live, group));
  const stillOut = ["Zara", "Ben"].filter((name) => after.some((loop) => names(loop, live).includes(name)));
  const directed =
    !!trio &&
    gives(trio, live, "You", "Sam", "air fryer") &&
    gives(trio, live, "Sam", "Emma", "controller") &&
    gives(trio, live, "Emma", "You", "microwave");
  if (!directed || still.length || stillOut.length || after.length !== expected.length + 1) {
    console.error("FAIL live", { directed, still, stillOut, count: after.length });
    process.exit(1);
  }

  await confirmFlow(expected);
  console.log("PASS");
}

async function confirmFlow(expected: string[][]) {
  const { addPerson, getDeclined, getLoops, meetLine, respond } = lib;
  const seeded = await getLoops();
  const unconfirmed = seeded.loops.filter(
    (loop) => loop.status !== "confirmed" || !validGoogleUrl(loop.meeting?.googleUrl) || !loop.meeting?.icsUrl,
  );
  if (seeded.loops.length !== expected.length || unconfirmed.length) {
    fail("seed confirmed", { count: seeded.loops.length, unconfirmed: unconfirmed.map((loop) => loop.id) });
  }
  console.log("seed loops confirmed:", seeded.loops.map((loop) => `${loop.id} @ ${loop.meeting?.place}`).join("; "));

  const you: Person = { id: "you", name: "You", has: ["Ninja air fryer"], wants: ["microwave"], createdAt: 1 };
  await addPerson(you);
  const joined = await getLoops();
  const live = joined.people;
  const trio = joined.loops.find((loop) => hasGroup([loop], live, ["You", "Sam", "Emma"]));
  const pinnedFirst = joined.loops.slice(0, expected.length).every((loop) => loop.status === "confirmed");
  if (
    !trio ||
    trio.status !== "pending" ||
    trio.decisions?.s8 !== "yes" ||
    trio.decisions?.s18 !== "yes" ||
    trio.decisions?.you !== undefined ||
    !pinnedFirst
  ) {
    fail("trio pending", { trio, pinnedFirst });
  }

  const outsider = await respond(trio.id, "s1", "yes");
  if (outsider.ok) fail("outsider rejected", outsider);

  const yes = await respond(trio.id, "you", "yes");
  if (!yes.ok || yes.body.status !== "confirmed" || !validGoogleUrl(yes.body.meeting.googleUrl)) {
    fail("trio confirm", yes);
  }
  if (yes.body.meeting.icsUrl !== `/api/meeting/${trio.id}.ics`) fail("ics url", yes.body.meeting);
  const confirmed = (await getLoops()).loops.find((loop) => loop.id === trio.id);
  if (confirmed?.status !== "confirmed" || confirmed.meeting?.googleUrl !== yes.body.meeting.googleUrl) {
    fail("trio cached state", confirmed);
  }
  console.log("trio confirmed:", `CONFIRMED: ${confirmed.message} | ${meetLine(confirmed.meeting)}`);

  const alex: Person = { id: "alex", name: "Alex", has: ["board games"], wants: ["Lululemon yoga mat"], createdAt: 2 };
  await addPerson(alex);
  const withAlex = await getLoops();
  const pair = withAlex.loops.find((loop) => hasGroup([loop], withAlex.people, ["Alex", "Zara"]));
  if (!pair || pair.status !== "pending" || pair.decisions?.s19 !== "yes") fail("pair pending", pair);

  const no = await respond(pair.id, "alex", "no");
  if (!no.ok || no.body.status !== "declined" || !(await getDeclined()).has(pair.id)) fail("pair decline", no);
  const afterNo = await getLoops();
  const stuck = afterNo.loops.filter((loop) => loop.people.includes("alex") || loop.people.includes("s19"));
  if (stuck.length || !afterNo.loops.some((loop) => loop.id === trio.id && loop.status === "confirmed")) {
    fail("decline frees people", stuck);
  }

  const max: Person = { id: "max", name: "Max", has: ["board games"], wants: ["Lululemon yoga mat"], createdAt: 3 };
  await addPerson(max);
  const rematched = await getLoops();
  const zaraMax = rematched.loops.find((loop) => hasGroup([loop], rematched.people, ["Zara", "Max"]));
  if (!zaraMax || zaraMax.status !== "pending") fail("zara rematch", rematched.loops.map((loop) => loop.id));
  console.log("declined", pair.id, "then Zara rematched in", zaraMax.id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
