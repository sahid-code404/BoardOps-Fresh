export type MealTiming = {
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function isDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

export function monthBounds(date: string): { start: string; end: string } {
  const [year, month] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`, end };
}

function zonedParts(instantMs: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Convert a wall-clock time in an IANA timezone to one unambiguous UTC ISO instant. */
export function zonedDateTimeIso(date: string, time: string, timeZone: string): string {
  if (!isDateString(date) || !TIME_RE.test(time)) throw new Error("Invalid local date/time");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = desiredAsUtc;

  // Two/three offset corrections handle DST boundaries without relying on the
  // Worker process timezone. All persisted cutoffs are UTC ISO timestamps.
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(instant, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    const delta = actualAsUtc - desiredAsUtc;
    if (delta === 0) break;
    instant -= delta;
  }
  return new Date(instant).toISOString();
}

export function dateInTimeZone(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant.getTime(), timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return dateInTimeZone(now, timeZone);
}

export function computeEditableUntilIso(meal: MealTiming, serviceDate: string, timeZone: string): string {
  const cutoffTime = TIME_RE.test(meal.cutoff_time) ? meal.cutoff_time : "16:00";
  const cutoffDate = meal.cutoff_strategy === "PREVIOUS_DAY" ? addDays(serviceDate, -1) : serviceDate;
  const base = zonedDateTimeIso(cutoffDate, cutoffTime, timeZone);
  if (meal.cutoff_strategy !== "CUSTOM_OFFSET") return base;
  const offset = Math.max(0, Math.min(1440, Number(meal.cutoff_offset_minutes) || 0));
  return new Date(new Date(base).getTime() - offset * 60_000).toISOString();
}

export function isLockedAt(editableUntil: string, now = new Date()): boolean {
  const instant = Date.parse(editableUntil);
  return Number.isFinite(instant) && now.getTime() > instant;
}

export function isOverridden(status: string, originalState: string): boolean {
  const effective = status === "LOCKED" ? "ON" : status;
  return effective !== originalState;
}

export function isBeforeEnrollment(
  serviceDate: string,
  userCreatedAt: string,
  meal: MealTiming,
  timeZone: string,
): boolean {
  const created = new Date(userCreatedAt);
  const registrationDate = dateInTimeZone(created, timeZone);
  if (serviceDate < registrationDate) return true;
  if (serviceDate > registrationDate) return false;
  return created.getTime() > new Date(computeEditableUntilIso(meal, serviceDate, timeZone)).getTime();
}

export function enumerateDates(startDate: string, endDate: string, maxDays = 90): string[] | null {
  if (!isDateString(startDate) || !isDateString(endDate) || endDate < startDate) return null;
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate && dates.length <= maxDays) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates.length > maxDays ? null : dates;
}
