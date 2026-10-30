import { buildEdges, canonicalize, selectDeals } from "../lib/match";
import { loadSeed } from "../lib/store";
import type { Loop, Person } from "../lib/types";

function names(loop: Loop, people: Person[]): string[] {
  return loop.people.map((id) => people.find((person) => person.id === id)?.name ?? id).sort();
}

function hasGroup(loops: Loop[], people: Person[], group: string[]): boolean {
  const want = [...group].sort().join(",");
  return loops.some((loop) => names(loop, people).join(",") === want);
}

async function main() {
  const people = loadSeed();
  const items = people.flatMap((person) => [...person.has, ...person.wants]);
  const { canon, usedFallback } = await canonicalize(items);
  const edges = buildEdges(people, canon);
  const loops = selectDeals(people, edges);

  console.log("fallback:", usedFallback);
  console.log(
    "labels:",
    Object.fromEntries([...canon.entries()].map(([item, row]) => [item, `${row.label} ($${row.value})`])),
  );
  console.log(
    "loops:",
    loops.map((loop) => ({
      id: loop.id,
      people: names(loop, people),
      value: loop.totalValue,
    })),
  );

  const three = hasGroup(loops, people, ["Priya", "Marcus", "Lena"]);
  const four = hasGroup(loops, people, ["Diego", "Aisha", "Tom", "Kim"]);
  const sam = loops.some((loop) => loop.people.includes("s8"));

  if (!three || !four || sam) {
    console.error("FAIL", { three, four, samUnmatched: !sam });
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
