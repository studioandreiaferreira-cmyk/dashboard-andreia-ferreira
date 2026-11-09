import type { BusinessHours } from "../config";

export const SP_TZ = "America/Sao_Paulo";
const MINUTE = 60_000;
const DAY = 86_400_000;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as unknown as LocalParts;
}

/** Offset (minutes) of `tz` relative to UTC at instant `ms` (e.g. -180 for São Paulo). */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** Converts a local wall-clock time in `tz` to a UTC epoch (ms). */
function localToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - tzOffsetMinutes(guess, tz) * MINUTE;
  ms = guess - tzOffsetMinutes(ms, tz) * MINUTE;
  return ms;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of the instant in the given timezone (default São Paulo). */
export function toDaySP(iso: string | number | Date, tz = SP_TZ): string {
  const ms = typeof iso === "number" ? iso : new Date(iso).getTime();
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function todaySP(now: Date | number = Date.now(), tz = SP_TZ): string {
  return toDaySP(typeof now === "number" ? now : now.getTime(), tz);
}

function dayToUtcNoon(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

/** Adds `n` calendar days to a YYYY-MM-DD string. */
export function addDays(day: string, n: number): string {
  const d = new Date(dayToUtcNoon(day) + n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole calendar days (in SP) between the day of `fromIso` and the day of `now`. */
export function daysBetweenSP(fromIso: string, now: Date | number = Date.now(), tz = SP_TZ): number {
  const a = dayToUtcNoon(toDaySP(fromIso, tz));
  const b = dayToUtcNoon(todaySP(now, tz));
  return Math.max(0, Math.round((b - a) / DAY));
}

/** Inclusive list of YYYY-MM-DD days from `from` to `to`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD day. */
export function isoWeekday(day: string): number {
  const wd = new Date(dayToUtcNoon(day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Minutes between two instants that fall inside the configured business hours. */
export function businessMinutesBetween(startIso: string | number, endIso: string | number, bh: BusinessHours): number {
  const start = typeof startIso === "number" ? startIso : new Date(startIso).getTime();
  const end = typeof endIso === "number" ? endIso : new Date(endIso).getTime();
  if (!(end > start)) return 0;
  const tz = bh.tz || SP_TZ;
  const [sh, sm] = bh.start.split(":").map(Number);
  const [eh, em] = bh.end.split(":").map(Number);
  let total = 0;
  const lastDay = toDaySP(end, tz);
  for (let day = toDaySP(start, tz); day <= lastDay; day = addDays(day, 1)) {
    if (!bh.days.includes(isoWeekday(day))) continue;
    const [y, m, d] = day.split("-").map(Number);
    const winStart = localToUtc(y, m, d, sh, sm, tz);
    const winEnd = localToUtc(y, m, d, eh, em, tz);
    const overlap = Math.min(end, winEnd) - Math.max(start, winStart);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(total / MINUTE);
}

/** SQLite datetime modifier that shifts UTC timestamps to `tz` wall time at `now` (e.g. "-180 minutes"). */
export function sqliteTzModifier(now: Date | number = Date.now(), tz = SP_TZ): string {
  return `${tzOffsetMinutes(typeof now === "number" ? now : now.getTime(), tz)} minutes`;
}

/** UTC ISO instant at which the given São Paulo day starts. */
export function dayStartUtc(day: string, tz = SP_TZ): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(localToUtc(y, m, d, 0, 0, tz)).toISOString();
}
