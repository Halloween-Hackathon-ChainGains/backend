import type { Meeting } from "./store";
import type { Loop, Person } from "./types";

const ZONE = "America/New_York";
const PLACES = ["Kimmel Center lobby", "Bobst Library entrance", "Washington Square Park arch"];
const DURATION_MS = 30 * 60 * 1000;

export function createMeeting(loop: Loop, people: Person[], now = new Date()): Meeting {
  const today = zonedParts(now);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const start = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 12, 30);
  const end = new Date(start.getTime() + DURATION_MS);
  const place = PLACES[hash(loop.id) % PLACES.length];
  const { title, details } = meetingText(loop, people);
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(title)}`,
    `dates=${calendarStamp(start)}/${calendarStamp(end)}`,
    `details=${encodeURIComponent(details)}`,
    `location=${encodeURIComponent(place)}`,
  ];
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    place,
    googleUrl: `https://calendar.google.com/calendar/render?${params.join("&")}`,
    icsUrl: `/api/meeting/${loop.id}.ics`,
  };
}

export function meetingText(loop: Loop, people: Person[]): { title: string; details: string } {
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const name = (id: string) => nameOf.get(id) ?? id;
  const title = `Loop trade: ${loop.people.map(name).join(", ")}`;
  const lines = loop.people.map((id) => {
    const give = loop.trades.find((trade) => trade.from === id);
    const get = loop.trades.find((trade) => trade.to === id);
    return `${name(id)} gives ${give?.item ?? "?"} to ${give ? name(give.to) : "?"}, gets ${get?.item ?? "?"} from ${get ? name(get.from) : "?"}.`;
  });
  return { title, details: [loop.message, "", ...lines].join("\n") };
}

export function meetLine(meeting: Meeting): string {
  const start = new Date(meeting.start);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long" }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(start);
  return `Meet ${weekday}, ${time} ET at ${meeting.place}`;
}

export function toICS(loop: Loop, people: Person[], meeting: Meeting, now = new Date()): string {
  const { title, details } = meetingText(loop, people);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Loop//Trade Loops//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${loop.id}@loop`,
    `DTSTAMP:${calendarStamp(now)}`,
    `DTSTART:${calendarStamp(new Date(meeting.start))}`,
    `DTEND:${calendarStamp(new Date(meeting.end))}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(details)}`,
    `LOCATION:${escapeText(meeting.place)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export function calendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const wall = zonedParts(new Date(guess));
  const offset = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - guess;
  return new Date(guess - offset);
}

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = Buffer.byteLength(char, "utf8");
    const limit = chunks.length === 0 ? 75 : 74;
    if (size + width > limit) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}
