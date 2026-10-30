import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { LoopsResponse, Person } from "./types";

export type Canon = { label: string; value: number };

const memory = new Map<string, unknown>();
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

export async function resetLive(): Promise<void> {
  const version = await getVersion();
  const keys = [`people`, `loops:${version}`];
  const client = getRedis();
  if (!client) {
    for (const key of [...memory.keys()]) {
      if (key === "people" || key.startsWith("loops:")) memory.delete(key);
    }
  } else {
    try {
      const cached = await client.keys("loops:*");
      keys.push(...cached);
    } catch {
      // Version bump still makes the previous cache unread.
    }
    await kvDel([...new Set(keys)]);
  }
  await bumpVersion();
}

function canonKey(item: string): string {
  return `canon:${item.trim().toLowerCase()}`;
}

export async function getCanon(item: string): Promise<Canon | null> {
  const value = await kvGet<Canon>(canonKey(item));
  if (!value || typeof value.label !== "string" || typeof value.value !== "number") return null;
  return value;
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
