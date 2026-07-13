import type { AvailabilityWindow, HourInterval, Room } from "./types.js";

export const MOSCOW_TIMEZONE = "Europe/Moscow";

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function moscowToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function clockFromMinutes(totalMinutes: number): string {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function startsAt(date: string, minutes: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + Math.floor(minutes / 1440));
  return `${day.toISOString().slice(0, 10)}T${clockFromMinutes(minutes)}:00+03:00`;
}

function minuteOfDay(time: string | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function mergeIntervals(intervals: readonly HourInterval[]): Array<[number, number]> {
  const sorted = intervals
    .map(([start, end]) => [start * 60, end * 60] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) {
      merged.push([...interval]);
      continue;
    }
    previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function roomBlocks(room: Room, date: string): Array<[number, number]> {
  return mergeIntervals([...room.defaultBlocked, ...(room.blockedByDate[date] ?? [])]);
}

export function availabilityForRoom(
  room: Room,
  date: string,
  durationMinutes: number,
  preferredTime?: string,
): AvailabilityWindow[] {
  const opens = room.opensAtHour * 60;
  const closes = room.closesAtHour * 60;
  const preferredTimeMinutes = minuteOfDay(preferredTime);
  const preferred = preferredTimeMinutes !== null && preferredTimeMinutes < opens
    ? preferredTimeMinutes + 1440
    : preferredTimeMinutes;
  const blocks = roomBlocks(room, date);
  const windows: AvailabilityWindow[] = [];

  for (let start = opens; start + durationMinutes <= closes; start += 30) {
    const containing = blocks.find(([blockedStart, blockedEnd]) => start >= blockedStart && start < blockedEnd);
    if (containing) continue;
    const nextBlock = blocks.find(([blockedStart]) => blockedStart > start);
    const freeUntil = Math.min(closes, nextBlock?.[0] ?? closes);
    const maximumDurationMinutes = freeUntil - start;
    if (maximumDurationMinutes < durationMinutes) continue;
    windows.push({
      startsAt: startsAt(date, start),
      maximumDurationMinutes,
      exactMatch: preferred === start,
    });
  }

  return windows;
}

export function intersectAvailability(
  roomWindows: AvailabilityWindow[][],
  durationMinutes: number,
  preferredTime?: string,
): AvailabilityWindow[] {
  if (!roomWindows.length) return [];
  const preferred = minuteOfDay(preferredTime);
  const first = new Map(roomWindows[0]?.map((window) => [window.startsAt, window]) ?? []);
  for (const windows of roomWindows.slice(1)) {
    const current = new Map(windows.map((window) => [window.startsAt, window]));
    for (const [key, value] of first) {
      const other = current.get(key);
      if (!other) {
        first.delete(key);
        continue;
      }
      value.maximumDurationMinutes = Math.min(value.maximumDurationMinutes, other.maximumDurationMinutes);
    }
  }
  return [...first.values()]
    .filter((window) => window.maximumDurationMinutes >= durationMinutes)
    .map((window) => ({
      ...window,
      exactMatch: preferred === minuteOfDay(window.startsAt.slice(11, 16)),
    }))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}
