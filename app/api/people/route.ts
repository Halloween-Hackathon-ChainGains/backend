import { randomUUID } from "node:crypto";
import { addPerson, getPeople } from "../../../lib/store";
import type { Person } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const people = await getPeople();
    return Response.json(people, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Expected {name, has, wants}" }, { status: 400 });
    }
    const input = body as { name?: unknown; has?: unknown; wants?: unknown };
    if (typeof input.name !== "string") {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }
    const name = input.name.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });

    const has = cleanList(input.has);
    const wants = cleanList(input.wants);
    if (!has || !wants) {
      return Response.json({ error: "has and wants must be arrays of strings" }, { status: 400 });
    }

    const person: Person = {
      id: randomUUID(),
      name,
      has,
      wants,
      createdAt: Date.now(),
    };
    await addPerson(person);
    return Response.json(person);
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

function cleanList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().replace(/[\r\n]+/g, " ").slice(0, 60);
    if (!trimmed) continue;
    items.push(trimmed);
    if (items.length === 5) break;
  }
  return items;
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Request failed";
}
