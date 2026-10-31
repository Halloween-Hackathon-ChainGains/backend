import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { Loop, LoopsResponse, Person } from "./types";

export type Canon = { label: string; value: number };

// Next bundles each route separately; a global keeps one in-memory store across them.
const shared = globalThis as typeof globalThis & { __loopMemory?: Map<string, unknown> };
const memory = (shared.__loopMemory ??= new Map<string, unknown>());
let redis: Redis | null | undefined;

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadDotEnv();

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    redis = null;
    return null;
  }
  if (!process.env.UPSTASH_REDIS_REST_URL) process.env.UPSTASH_REDIS_REST_URL = url;
  if (!process.env.UPSTASH_REDIS_REST_TOKEN) process.env.UPSTASH_REDIS_REST_TOKEN = token;
  try {
    redis = Redis.fromEnv();
  } catch {
    try {
      redis = new Redis({ url, token });
    } catch {
      redis = null;
    }
  }
  return redis;
}

async function kvGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) {
    return memory.has(key) ? (memory.get(key) as T) : null;
  }
  const value = await client.get<T>(key);
  return value ?? null;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const client = getRedis();
  if (!client) {
    memory.set(key, value);
    return;
  }
  await client.set(key, value);
}

async function kvDel(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const client = getRedis();
  if (!client) {
    for (const key of keys) memory.delete(key);
    return;
  }
  await client.del(...keys);
}

export function loadSeed(): Person[] {
  try {
    const raw = readFileSync(path.join(process.cwd(), "data", "seed.json"), "utf8");
    const parsed = JSON.parse(raw) as Person[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getPeople(): Promise<Person[]> {
  const live = (await kvGet<Person[]>("people")) ?? [];
  const seed = loadSeed();
  const seen = new Set(seed.map((person) => person.id));
  const extra = live.filter((person) => person && typeof person.id === "string" && !seen.has(person.id));
  return [...seed, ...extra];
}

export async function addPerson(person: Person): Promise<void> {
  const live = (await kvGet<Person[]>("people")) ?? [];
  await kvSet("people", [...live, person]);
  await bumpVersion();
}

export async function getVersion(): Promise<number> {
  const value = await kvGet<number | string>("version");
  const version = typeof value === "number" ? value : Number(value);
  return Number.isFinite(version) ? version : 0;
}

export async function bumpVersion(): Promise<number> {
  const client = getRedis();
  if (!client) {
    const next = (await getVersion()) + 1;
    memory.set("version", next);
    return next;
  }
  return client.incr("version");
}

const LIVE_PREFIXES = ["loops:", "decisions:", "meeting:"];
const LIVE_KEYS = ["people", "declined", "confirmed"];

export async function resetLive(): Promise<void> {
  const version = await getVersion();
  const keys = [...LIVE_KEYS, `loops:${version}`];
  const client = getRedis();
  if (!client) {
    for (const key of [...memory.keys()]) {
      if (LIVE_KEYS.includes(key) || LIVE_PREFIXES.some((prefix) => key.startsWith(prefix))) memory.delete(key);
    }
  } else {
    for (const prefix of LIVE_PREFIXES) {
      try {
        keys.push(...(await client.keys(`${prefix}*`)));
      } catch {
        // Version bump still makes the previous cache unread.
      }
    }
    await kvDel([...new Set(keys)]);
  }
  await bumpVersion();
}

export type Decision = "yes" | "no";
export type Meeting = NonNullable<Loop["meeting"]>;

export async function getDecisions(loopId: string): Promise<Record<string, Decision>> {
  const key = `decisions:${loopId}`;
  const client = getRedis();
  const raw = client
    ? await client.hgetall<Record<string, unknown>>(key)
    : (memory.get(key) as Record<string, unknown> | undefined);
  const out: Record<string, Decision> = {};
  for (const [personId, value] of Object.entries(raw ?? {})) {
    if (value === "yes" || value === "no") out[personId] = value;
  }
  return out;
}

export async function setDecision(loopId: string, personId: string, decision: Decision): Promise<void> {
  const key = `decisions:${loopId}`;
  const client = getRedis();
  if (!client) {
    const current = (memory.get(key) as Record<string, Decision> | undefined) ?? {};
    memory.set(key, { ...current, [personId]: decision });
    return;
  }
  await client.hset(key, { [personId]: decision });
}

export async function getDeclined(): Promise<Set<string>> {
  const client = getRedis();
  if (!client) return new Set((memory.get("declined") as string[] | undefined) ?? []);
  const members = await client.smembers("declined");
  return new Set(members.map(String));
}

export async function addDeclined(loopId: string): Promise<void> {
  const client = getRedis();
  if (!client) {
    const current = (memory.get("declined") as string[] | undefined) ?? [];
    if (!current.includes(loopId)) memory.set("declined", [...current, loopId]);
    return;
  }
  await client.sadd("declined", loopId);
}

export async function getMeeting(loopId: string): Promise<Meeting | null> {
  const value = await kvGet<Meeting>(`meeting:${loopId}`);
  return value && typeof value.start === "string" ? value : null;
}

export async function getConfirmedLoops(): Promise<Loop[]> {
  const client = getRedis();
  const raw = client
    ? await client.hgetall<Record<string, Loop>>("confirmed")
    : (memory.get("confirmed") as Record<string, Loop> | undefined);
  return Object.values(raw ?? {})
    .filter((loop) => loop && typeof loop.id === "string" && Array.isArray(loop.people) && Array.isArray(loop.trades))
    .map((loop) => ({ ...loop }));
}

export async function getConfirmedLoop(loopId: string): Promise<Loop | null> {
  const client = getRedis();
  if (!client) {
    const all = (memory.get("confirmed") as Record<string, Loop> | undefined) ?? {};
    return all[loopId] ?? null;
  }
  return (await client.hget<Loop>("confirmed", loopId)) ?? null;
}

export async function saveConfirmed(loop: Loop, meeting: Meeting): Promise<void> {
  const snapshot: Loop = {
    id: loop.id,
    people: loop.people,
    trades: loop.trades,
    message: loop.message,
    totalValue: loop.totalValue,
  };
  await kvSet(`meeting:${loop.id}`, meeting);
  const client = getRedis();
  if (!client) {
    const current = (memory.get("confirmed") as Record<string, Loop> | undefined) ?? {};
    memory.set("confirmed", { ...current, [loop.id]: snapshot });
    return;
  }
  await client.hset("confirmed", { [loop.id]: snapshot });
}

function canonKey(item: string): string {
  return `canon:${item.trim().toLowerCase()}`;
}

function readCanonSeed(): Record<string, Canon> {
  try {
    const raw = readFileSync(path.join(process.cwd(), "data", "canon-seed.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, Canon>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

const canonSeed = readCanonSeed();
const canonSeedByKey = new Map<string, Canon>();
for (const [item, canon] of Object.entries(canonSeed)) {
  if (!canon || typeof canon.label !== "string" || typeof canon.value !== "number") continue;
  canonSeedByKey.set(item.trim().toLowerCase(), { label: canon.label, value: canon.value });
}

function seededCanon(item: string): Canon | null {
  return canonSeedByKey.get(item.trim().toLowerCase()) ?? null;
}

let preloadTask: Promise<void> | null = null;

export function preloadCanon(): Promise<void> {
  if (!preloadTask) {
    preloadTask = (async () => {
      for (const [item, canon] of canonSeedByKey) {
        try {
          await setCanon(item, canon);
        } catch {
          // Seed lookups still succeed from canon-seed.json.
        }
      }
    })();
  }
  return preloadTask;
}

void preloadCanon();

export async function getCanon(item: string): Promise<Canon | null> {
  const seeded = seededCanon(item);
  if (seeded) return seeded;
  try {
    const value = await kvGet<Canon>(canonKey(item));
    if (!value || typeof value.label !== "string" || typeof value.value !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

export async function setCanon(item: string, canon: Canon): Promise<void> {
  await kvSet(canonKey(item), canon);
}

export async function getCachedLoops(version: number): Promise<LoopsResponse | null> {
  const value = await kvGet<LoopsResponse>(`loops:${version}`);
  if (!value || !Array.isArray(value.people) || !Array.isArray(value.loops)) return null;
  return value;
}

export async function setCachedLoops(version: number, body: LoopsResponse): Promise<void> {
  await kvSet(`loops:${version}`, body);
}

export async function getLoopMessage(id: string): Promise<string | null> {
  const value = await kvGet<string>(`loopmsg:${id}`);
  return typeof value === "string" && value.trim() ? value : null;
}

export async function setLoopMessage(id: string, message: string): Promise<void> {
  await kvSet(`loopmsg:${id}`, message);
}
