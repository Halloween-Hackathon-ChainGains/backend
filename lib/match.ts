import { findLoops } from "./cycles";
import { grokJSON } from "./grok";
import {
  getCachedLoops,
  getCanon,
  getLoopMessage,
  getPeople,
  getVersion,
  setCachedLoops,
  setCanon,
  setLoopMessage,
  type Canon,
} from "./store";
import type { Loop, LoopsResponse, Person, Trade } from "./types";

const CANON_SYSTEM = `You normalize student trade listings for a campus swap.
Return a JSON object whose keys are the input item strings EXACTLY as given.
Each value is {"label": string, "value": number}.
label is a short lowercase name, 1 to 3 words, for the kind of thing.
Items a student would accept as the same trade MUST share a character-for-character identical label.
Be generous: "27in Dell display" and "monitor" are the same, "Stewart Calc 8e" and "calculus textbook" are the same, a road bike and a bike are the same, a compact fridge and a mini fridge are the same, Sony WH-1000XM4 and noise cancelling headphones are the same, a sit-stand desk and a standing desk are the same, a January sublet and a Manhattan sublet are the same.
Do not merge different kinds of things. A textbook is not a monitor. A bike is not a desk. A controller is not an air fryer.
If an existing label already fits, reuse that exact string.
value is the used resale price in USD as a number. For a sublet, use one month of typical student rent. For a service, use a reasonable one-time price.`;

const MESSAGE_SYSTEM = `You write one friendly sentence for each campus trade loop.
Return JSON {"messages": {"<loop id>": "<sentence>"}}.
Name every person and use a short item name.
Example shape: "Priya gives Marcus the calc book, Marcus gives Lena the monitor, Lena gives Priya the fridge."
One sentence per loop. No line breaks.`;

export async function canonicalize(items: string[]): Promise<{ canon: Map<string, Canon>; usedFallback: boolean }> {
  const unique = [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  const canon = new Map<string, Canon>();
  const uncached: string[] = [];
  const labels = new Set<string>();
  let usedFallback = false;

  for (const item of unique) {
    let cached: Canon | null = null;
    try {
      cached = await getCanon(item);
    } catch {
      cached = null;
    }
    if (cached) {
      canon.set(item, cached);
      labels.add(cached.label);
    } else {
      uncached.push(item);
    }
  }

  if (uncached.length === 0) return { canon, usedFallback };

  let mapped: Record<string, unknown> = {};
  try {
    const raw = await grokJSON(
      CANON_SYSTEM,
      JSON.stringify({ items: uncached, existingLabels: [...labels] }),
    );
    mapped = unwrapMap(raw, uncached);
  } catch {
    mapped = {};
  }

  for (const item of uncached) {
    const parsed = asCanon(findRow(mapped, item), item);
    const fromModel = mapped[item] !== undefined && parsed.fromModel;
    if (fromModel) {
      canon.set(item, parsed.canon);
      try {
        await setCanon(item, parsed.canon);
      } catch {
        // A cache miss next time is safe.
      }
    } else {
      usedFallback = true;
      canon.set(item, { label: item.trim().toLowerCase(), value: 20 });
    }
  }

  return { canon, usedFallback };
}

export function buildEdges(people: Person[], canon: Map<string, Canon>): Trade[] {
  const edges: Trade[] = [];
  for (const giver of people) {
    for (const receiver of people) {
      if (giver.id === receiver.id) continue;
      let best: Trade | null = null;
      for (const hasItem of giver.has) {
        const offered = lookup(canon, hasItem);
        if (!offered) continue;
        for (const wantItem of receiver.wants) {
          const wanted = lookup(canon, wantItem);
          if (!wanted || offered.label !== wanted.label) continue;
          if (!best || offered.value > best.value) {
            best = { from: giver.id, to: receiver.id, item: hasItem, value: offered.value };
          }
        }
      }
      if (best) edges.push(best);
    }
  }
  return edges;
}

export function selectDeals(people: Person[], edges: Trade[]): Loop[] {
  const index = new Map(people.map((person, i) => [person.id, i]));
  const adj: number[][] = people.map(() => []);
  const edgeByPair = new Map<string, Trade>();

  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const key = `${from}->${to}`;
    if (edgeByPair.has(key)) continue;
    edgeByPair.set(key, edge);
    adj[from].push(to);
  }

  const found = findLoops(adj).map((path) => {
    const ids = path.map((node) => people[node].id);
    const trades: Trade[] = [];
    for (let i = 0; i < path.length; i++) {
      const trade = edgeByPair.get(`${path[i]}->${path[(i + 1) % path.length]}`);
      if (trade) trades.push(trade);
    }
    const totalValue = trades.reduce((sum, trade) => sum + trade.value, 0);
    return {
      id: [...ids].sort().join("-"),
      people: ids,
      trades,
      message: "",
      totalValue,
    } satisfies Loop;
  });

  found.sort((a, b) => b.people.length - a.people.length || b.totalValue - a.totalValue);

  const used = new Set<string>();
  const picked: Loop[] = [];
  for (const loop of found) {
    if (loop.trades.length !== loop.people.length) continue;
    if (loop.people.some((id) => used.has(id))) continue;
    for (const id of loop.people) used.add(id);
    picked.push(loop);
  }
  return picked;
}

export async function fillMessages(loops: Loop[], people: Person[]): Promise<void> {
  const names = new Map(people.map((person) => [person.id, person.name]));
  const missing: Loop[] = [];

  for (const loop of loops) {
    let cached: string | null = null;
    try {
      cached = await getLoopMessage(loop.id);
    } catch {
      cached = null;
    }
    if (cached) loop.message = cached;
    else missing.push(loop);
  }
  if (missing.length === 0) return;

  let messages: Record<string, unknown> = {};
  try {
    const raw = await grokJSON(
      MESSAGE_SYSTEM,
      JSON.stringify({
        loops: missing.map((loop) => ({
          id: loop.id,
          trades: loop.trades.map((trade) => ({
            from: names.get(trade.from) ?? trade.from,
            to: names.get(trade.to) ?? trade.to,
            item: trade.item,
          })),
        })),
      }),
    );
    messages = unwrapMessages(raw);
  } catch {
    messages = {};
  }

  for (const loop of missing) {
    const generated = messages[loop.id];
    const message = typeof generated === "string" && generated.trim()
      ? generated.replace(/\s+/g, " ").trim()
      : templateMessage(loop, names);
    loop.message = message;
    if (typeof generated === "string" && generated.trim()) {
      try {
        await setLoopMessage(loop.id, message);
      } catch {
        // The loops cache still holds this sentence for the current version.
      }
    }
  }
}

export async function computeLoops(): Promise<{ body: LoopsResponse; complete: boolean }> {
  const people = await getPeople();
  const items = people.flatMap((person) => [...person.has, ...person.wants]);
  const { canon, usedFallback } = await canonicalize(items);
  const edges = buildEdges(people, canon);
  const loops = selectDeals(people, edges);
  await fillMessages(loops, people);
  const body: LoopsResponse = {
    people,
    edges,
    loops,
    stats: {
      items: loops.reduce((sum, loop) => sum + loop.trades.length, 0),
      dollars: Math.round(loops.reduce((sum, loop) => sum + loop.totalValue, 0)),
      people: people.length,
    },
  };
  return { body, complete: !usedFallback };
}

const inflight = new Map<number, Promise<LoopsResponse>>();

export async function getLoops(): Promise<LoopsResponse> {
  const version = await getVersion();
  const cached = await getCachedLoops(version);
  if (cached) return cached;

  const existing = inflight.get(version);
  if (existing) return existing;

  const job = (async () => {
    const { body, complete } = await computeLoops();
    if (complete) {
      const now = await getVersion();
      if (now === version) {
        try {
          await setCachedLoops(version, body);
        } catch {
          // The next poll recomputes. Canon results stay cached.
        }
      }
    }
    return body;
  })().finally(() => {
    inflight.delete(version);
  });

  inflight.set(version, job);
  return job;
}

function lookup(canon: Map<string, Canon>, item: string): Canon | undefined {
  return canon.get(item) ?? canon.get(item.trim());
}

function asCanon(value: unknown, item: string): { canon: Canon; fromModel: boolean } {
  if (!value || typeof value !== "object") {
    return { canon: { label: item.trim().toLowerCase(), value: 20 }, fromModel: false };
  }
  const row = value as { label?: unknown; value?: unknown };
  const label = typeof row.label === "string" ? row.label.trim().toLowerCase().replace(/\s+/g, " ") : "";
  const numeric = typeof row.value === "number" ? row.value : Number(String(row.value ?? "").replace(/[$,]/g, ""));
  if (!label || !Number.isFinite(numeric)) {
    return { canon: { label: item.trim().toLowerCase(), value: 20 }, fromModel: false };
  }
  return { canon: { label: label.slice(0, 40), value: Math.max(0, Math.round(numeric)) }, fromModel: true };
}

function unwrapMap(raw: unknown, items: string[]): Record<string, unknown> {
  if (Array.isArray(raw)) return rowsToMap(raw);
  const record = asRecord(raw);
  if (!record) return {};
  if (items.some((item) => item in record)) return record;
  for (const key of ["items", "mapping", "result", "data", "canonical"]) {
    if (Array.isArray(record[key])) return rowsToMap(record[key] as unknown[]);
    const inner = asRecord(record[key]);
    if (inner && items.some((item) => item in inner)) return inner;
  }
  return record;
}

function rowsToMap(rows: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const item = record.item ?? record.input ?? record.name;
    if (typeof item === "string") out[item] = record;
  }
  return out;
}

function findRow(mapped: Record<string, unknown>, item: string): unknown {
  if (item in mapped) return mapped[item];
  const want = item.trim().toLowerCase();
  for (const [key, value] of Object.entries(mapped)) {
    if (key.trim().toLowerCase() === want) return value;
  }
  return undefined;
}

function unwrapMessages(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw);
  if (!record) return {};
  const nested = asRecord(record.messages);
  return nested ?? record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function templateMessage(loop: Loop, names: Map<string, string>): string {
  const parts = loop.trades.map((trade) => {
    const from = names.get(trade.from) ?? trade.from;
    const to = names.get(trade.to) ?? trade.to;
    return `${from} gives ${to} the ${trade.item}`;
  });
  if (parts.length === 0) return "A trade loop is ready.";
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
