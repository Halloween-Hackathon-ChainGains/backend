export type Person = { id: string; name: string; has: string[]; wants: string[]; createdAt: number };
export type Trade  = { from: string; to: string; item: string; value: number }; // from/to are Person ids
export type Loop   = {
  id: string; people: string[]; trades: Trade[]; message: string; totalValue: number;
  status?: "pending" | "confirmed" | "declined";
  decisions?: Record<string, "yes" | "no">; // personId -> decision
  meeting?: { start: string; end: string; place: string; googleUrl: string; icsUrl: string };
};
export type LoopsResponse = { people: Person[]; edges: Trade[]; loops: Loop[]; stats: { items: number; dollars: number; people: number } };
