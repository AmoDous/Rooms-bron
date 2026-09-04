import { createHash } from "node:crypto";
import { availabilityForRoom, intersectAvailability, isIsoDate } from "./availability.js";
import type { HourInterval, Room } from "./types.js";

export const ROOMS_PLANNER_VERSION = "0.2.0";
export const DEFAULT_PLANNING_WEIGHTS: PlanningWeights = {
  timeShift: 0.5,
  fragmentation: 0.25,
  price: 0.15,
  capacitySlack: 0.1,
};

export type PlanningCriterion = "timeShift" | "fragmentation" | "price" | "capacitySlack";
export type PlanningRejectionCode = "CAPACITY" | "MINIMUM_DURATION" | "PRICE_LIMIT" | "NO_COMMON_WINDOW" | "REQUIRED_FEATURES" | "SERVICE_UNAVAILABLE";
export type PlanningReasonCode = "EXACT_START" | "SHIFTED_START" | "PRESERVES_SCHEDULE" | "REDUCES_FRAGMENTATION" | "CREATES_SHORT_GAP" | "LOWEST_PRICE" | "CAPACITY_MATCH" | "REQUIRED_FEATURES_MATCH" | "SERVICES_INCLUDED" | "DYNAMIC_PRICE";

export interface PlanningWeights {
  timeShift: number;
  fragmentation: number;
  price: number;
  capacitySlack: number;
}

export interface PlanningRoomSet {
  id: string;
  rooms: readonly Room[];
  stepMinutesByRoomId?: Readonly<Record<string, number>>;
  bookingBufferByRoomId?: Readonly<Record<string, { beforeMinutes: number; afterMinutes: number }>>;
}

export interface PlanningRequest {
  date: string;
  preferredTime: string;
  durationMinutes: number;
  guests: number;
  roomSets: readonly PlanningRoomSet[];
  maxTotalPriceRub?: number;
  requiredFeatures?: readonly string[];
  requestedServiceIds?: readonly string[];
  maxVariants?: number;
  maxVariantsPerRoomSet?: number;
  weights?: Partial<PlanningWeights>;
}

export interface PlanningComponent {
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
  unit: "minutes" | "rub" | "ratio";
}

export interface PlanningReason {
  code: PlanningReasonCode;
  value: number | null;
}

export interface PlanningVariant {
  rank: number;
  roomSetId: string;
  roomIds: string[];
  startsAt: string;
  maximumDurationMinutes: number;
  exactStart: boolean;
  totalPriceRub: number;
  roomPriceRub: number;
  servicesPriceRub: number;
  totalCapacity: number;
  score: number;
  components: Record<PlanningCriterion, PlanningComponent>;
  reasons: PlanningReason[];
}

export interface PlanningRejection {
  roomSetId: string;
  codes: PlanningRejectionCode[];
}

export interface PlanningResult {
  algorithmVersion: string;
  constraintSetHash: string;
  candidatesEvaluated: number;
  exactCandidateAvailable: boolean;
  variants: PlanningVariant[];
  rejections: PlanningRejection[];
}

export function planningCandidateKey(roomSetId: string, startsAt: string): string {
  return JSON.stringify([roomSetId, startsAt]);
}

interface RawCandidate {
  roomSet: PlanningRoomSet;
  startsAt: string;
  maximumDurationMinutes: number;
  exactStart: boolean;
  totalPriceRub: number;
  roomPriceRub: number;
  servicesPriceRub: number;
  totalCapacity: number;
  timeShiftMinutes: number;
  addedOrphanedMinutes: number;
  capacitySlackRatio: number;
}

function rounded(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clockMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function startOffsetMinutes(date: string, startsAt: string): number {
  const [startDate = date, startClock = "00:00:00+03:00"] = startsAt.split("T");
  const baseDay = Date.parse(`${date}T00:00:00Z`);
  const selectedDay = Date.parse(`${startDate}T00:00:00Z`);
  return Math.round((selectedDay - baseDay) / 86_400_000) * 1440 + clockMinutes(startClock.slice(0, 5));
}

function isoWeekday(date: string, dayOffset = 0): number {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  const weekday = value.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function priceRuleAt(room: Room, date: string, minuteOffset: number) {
  const rules = (room.priceRules ?? []).filter((rule) => rule.active);
  const currentDay = Math.floor(minuteOffset / 1440);
  return rules.flatMap((rule) => [currentDay - 1, currentDay].flatMap((ruleDay) => {
    if (!rule.weekdays.includes(isoWeekday(date, ruleDay))) return [];
    const startsAt = ruleDay * 1440 + rule.startsAtHour * 60;
    const endsAt = ruleDay * 1440 + rule.endsAtHour * 60;
    return minuteOffset >= startsAt && minuteOffset < endsAt ? [rule] : [];
  })).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0];
}

export function roomPriceForBooking(room: Room, date: string, startsAt: string, durationMinutes: number): number {
  const start = startOffsetMinutes(date, startsAt);
  let total = 0;
  for (let minute = 0; minute < durationMinutes; minute += 1) {
    total += (priceRuleAt(room, date, start + minute)?.pricePerHour ?? room.pricePerHour) / 60;
  }
  return rounded(total, 2);
}

function selectedServices(roomSet: PlanningRoomSet, ids: readonly string[]) {
  const requested = new Set(ids);
  const found = new Map(roomSet.rooms.flatMap((room) => room.services).map((service) => [service.id, service]));
  return {
    missing: [...requested].filter((id) => !found.has(id)),
    selected: [...requested].flatMap((id) => found.get(id) ? [found.get(id)!] : []),
  };
}

function preferredOffsetMinutes(roomSet: PlanningRoomSet, preferredTime: string): number {
  const preferred = clockMinutes(preferredTime);
  const earliestOpening = Math.min(...roomSet.rooms.map((room) => room.opensAtHour * 60));
  const crossesMidnight = roomSet.rooms.some((room) => room.closesAtHour > 24);
  return crossesMidnight && preferred < earliestOpening ? preferred + 1440 : preferred;
}

function mergeMinuteIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals.filter(([start, end]) => end > start).sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function orphanedMinutes(room: Room, date: string, extraBlock?: [number, number]): number {
  const opens = room.opensAtHour * 60;
  const closes = room.closesAtHour * 60;
  const minimumDuration = room.minimumHours * 60;
  const source: HourInterval[] = [...room.defaultBlocked, ...(room.blockedByDate[date] ?? [])];
  const blocks: Array<[number, number]> = source.map(([start, end]) => [
    Math.max(opens, start * 60),
    Math.min(closes, end * 60),
  ]);
  if (extraBlock) blocks.push([Math.max(opens, extraBlock[0]), Math.min(closes, extraBlock[1])]);
  const merged = mergeMinuteIntervals(blocks);
  let cursor = opens;
  let total = 0;
  for (const [start, end] of merged) {
    const free = Math.max(0, start - cursor);
    if (free > 0 && free < minimumDuration) total += free;
    cursor = Math.max(cursor, end);
  }
  const tail = Math.max(0, closes - cursor);
  if (tail > 0 && tail < minimumDuration) total += tail;
  return total;
}

function addedOrphanedMinutes(request: PlanningRequest, roomSet: PlanningRoomSet, startsAt: string): number {
  const start = startOffsetMinutes(request.date, startsAt);
  return roomSet.rooms.reduce((total, room) => {
    const buffer = roomSet.bookingBufferByRoomId?.[room.id];
    const booking: [number, number] = [
      start - (buffer?.beforeMinutes ?? 0),
      start + request.durationMinutes + (buffer?.afterMinutes ?? 0),
    ];
    return total + orphanedMinutes(room, request.date, booking) - orphanedMinutes(room, request.date);
  }, 0);
}

function normalizedWeights(weights: Partial<PlanningWeights> | undefined): PlanningWeights {
  const merged: PlanningWeights = { ...DEFAULT_PLANNING_WEIGHTS, ...weights };
  const entries = Object.entries(merged) as Array<[PlanningCriterion, number]>;
  if (entries.some(([, value]) => !Number.isFinite(value) || value < 0)) throw new Error("Planning weights must be finite and non-negative.");
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) throw new Error("At least one planning weight must be positive.");
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total])) as unknown as PlanningWeights;
}

function validateRequest(request: PlanningRequest): void {
  if (!isIsoDate(request.date)) throw new Error("Planning date must use YYYY-MM-DD.");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(request.preferredTime)) throw new Error("Preferred time must use HH:MM.");
  if (!Number.isInteger(request.durationMinutes) || request.durationMinutes < 30 || request.durationMinutes > 720) throw new Error("Duration must be an integer from 30 to 720 minutes.");
  if (!Number.isInteger(request.guests) || request.guests < 1) throw new Error("Guests must be a positive integer.");
  if (!request.roomSets.length) throw new Error("At least one room set is required.");
  if (request.requiredFeatures && new Set(request.requiredFeatures).size !== request.requiredFeatures.length) throw new Error("Required features must be unique.");
  if (request.requestedServiceIds && new Set(request.requestedServiceIds).size !== request.requestedServiceIds.length) throw new Error("Requested services must be unique.");
  const ids = request.roomSets.map((roomSet) => roomSet.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) throw new Error("Room set identifiers must be non-empty and unique.");
  for (const roomSet of request.roomSets) {
    if (!roomSet.rooms.length) throw new Error(`Room set ${roomSet.id} is empty.`);
    const roomIds = roomSet.rooms.map((room) => room.id);
    if (new Set(roomIds).size !== roomIds.length) throw new Error(`Room set ${roomSet.id} contains duplicate rooms.`);
    if (new Set(roomSet.rooms.map((room) => room.venueId)).size !== 1) throw new Error(`Room set ${roomSet.id} contains rooms from different venues.`);
    for (const room of roomSet.rooms) {
      const step = roomSet.stepMinutesByRoomId?.[room.id] ?? 30;
      if (![15, 30, 60].includes(step)) throw new Error(`Room ${room.id} has an unsupported start step.`);
      const buffer = roomSet.bookingBufferByRoomId?.[room.id];
      if (buffer && (!Number.isInteger(buffer.beforeMinutes) || buffer.beforeMinutes < 0 || !Number.isInteger(buffer.afterMinutes) || buffer.afterMinutes < 0)) {
        throw new Error(`Room ${room.id} has an invalid booking buffer.`);
      }
    }
  }
  if (request.maxTotalPriceRub !== undefined && (!Number.isFinite(request.maxTotalPriceRub) || request.maxTotalPriceRub < 0)) throw new Error("Price limit must be non-negative.");
  if (request.maxVariants !== undefined && (!Number.isInteger(request.maxVariants) || request.maxVariants < 1 || request.maxVariants > 20)) throw new Error("maxVariants must be an integer from 1 to 20.");
  if (request.maxVariantsPerRoomSet !== undefined && (!Number.isInteger(request.maxVariantsPerRoomSet) || request.maxVariantsPerRoomSet < 1 || request.maxVariantsPerRoomSet > 10)) throw new Error("maxVariantsPerRoomSet must be an integer from 1 to 10.");
  normalizedWeights(request.weights);
}

function constraintHash(request: PlanningRequest, weights: PlanningWeights): string {
  const normalized = {
    algorithmVersion: ROOMS_PLANNER_VERSION,
    date: request.date,
    preferredTime: request.preferredTime,
    durationMinutes: request.durationMinutes,
    guests: request.guests,
    maxTotalPriceRub: request.maxTotalPriceRub ?? null,
    requiredFeatures: [...(request.requiredFeatures ?? [])].sort(),
    requestedServiceIds: [...(request.requestedServiceIds ?? [])].sort(),
    weights,
    roomSets: request.roomSets.map((roomSet) => ({
      id: roomSet.id,
      steps: roomSet.stepMinutesByRoomId ?? {},
      buffers: roomSet.bookingBufferByRoomId ?? {},
      rooms: roomSet.rooms.map((room) => ({
        id: room.id,
        venueId: room.venueId,
        capacityMin: room.capacityMin,
        capacityMax: room.capacityMax,
        pricePerHour: room.pricePerHour,
        priceRules: room.priceRules ?? [],
        features: [...room.features].sort(),
        services: room.services.map((service) => ({ id: service.id, price: service.price })),
        minimumHours: room.minimumHours,
        opensAtHour: room.opensAtHour,
        closesAtHour: room.closesAtHour,
        defaultBlocked: room.defaultBlocked,
        blockedByDate: room.blockedByDate,
      })),
    })),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function candidatesForRoomSet(request: PlanningRequest, roomSet: PlanningRoomSet): { candidates: RawCandidate[]; rejection: PlanningRejection | null } {
  const codes: PlanningRejectionCode[] = [];
  const totalCapacity = roomSet.rooms.reduce((sum, room) => sum + room.capacityMax, 0);
  const availableFeatures = new Set(roomSet.rooms.flatMap((room) => room.features));
  const services = selectedServices(roomSet, request.requestedServiceIds ?? []);
  const servicesPriceRub = rounded(services.selected.reduce((sum, service) => sum + service.price, 0), 2);
  if (request.guests > totalCapacity) codes.push("CAPACITY");
  if (roomSet.rooms.some((room) => request.durationMinutes < room.minimumHours * 60)) codes.push("MINIMUM_DURATION");
  if ((request.requiredFeatures ?? []).some((feature) => !availableFeatures.has(feature))) codes.push("REQUIRED_FEATURES");
  if (services.missing.length) codes.push("SERVICE_UNAVAILABLE");
  if (codes.length) return { candidates: [], rejection: { roomSetId: roomSet.id, codes } };
  const windows = intersectAvailability(roomSet.rooms.map((room) => availabilityForRoom(
    room,
    request.date,
    request.durationMinutes,
    request.preferredTime,
    roomSet.stepMinutesByRoomId?.[room.id] ?? 30,
    roomSet.bookingBufferByRoomId?.[room.id]?.beforeMinutes ?? 0,
    roomSet.bookingBufferByRoomId?.[room.id]?.afterMinutes ?? 0,
  )), request.durationMinutes, request.preferredTime);
  if (!windows.length) return { candidates: [], rejection: { roomSetId: roomSet.id, codes: ["NO_COMMON_WINDOW"] } };
  const preferred = preferredOffsetMinutes(roomSet, request.preferredTime);
  const candidates = windows.map((window) => {
    const roomPriceRub = rounded(roomSet.rooms.reduce((sum, room) => sum + roomPriceForBooking(room, request.date, window.startsAt, request.durationMinutes), 0), 2);
    return {
      roomSet,
      startsAt: window.startsAt,
      maximumDurationMinutes: window.maximumDurationMinutes,
      exactStart: window.exactMatch,
      totalPriceRub: rounded(roomPriceRub + servicesPriceRub, 2),
      roomPriceRub,
      servicesPriceRub,
      totalCapacity,
      timeShiftMinutes: Math.abs(startOffsetMinutes(request.date, window.startsAt) - preferred),
      addedOrphanedMinutes: addedOrphanedMinutes(request, roomSet, window.startsAt),
      capacitySlackRatio: totalCapacity ? Math.max(0, totalCapacity - request.guests) / totalCapacity : 1,
    };
  });
  const withinPrice = request.maxTotalPriceRub === undefined
    ? candidates
    : candidates.filter((candidate) => candidate.totalPriceRub <= request.maxTotalPriceRub!);
  if (!withinPrice.length) return { candidates: [], rejection: { roomSetId: roomSet.id, codes: ["PRICE_LIMIT"] } };
  return {
    candidates: withinPrice,
    rejection: null,
  };
}

function priceNormalized(candidate: RawCandidate, candidates: RawCandidate[], maxPrice: number | undefined): number {
  if (maxPrice !== undefined && maxPrice > 0) return clamp(candidate.totalPriceRub / maxPrice);
  const prices = candidates.map((item) => item.totalPriceRub);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  return maximum === minimum ? 0 : (candidate.totalPriceRub - minimum) / (maximum - minimum);
}

function component(raw: number, normalized: number, weight: number, unit: PlanningComponent["unit"]): PlanningComponent {
  return { raw: rounded(raw, 3), normalized: rounded(normalized), weight: rounded(weight), contribution: rounded(normalized * weight), unit };
}

function reasons(candidate: RawCandidate, minimumPrice: number): PlanningReason[] {
  const values: PlanningReason[] = [candidate.exactStart
    ? { code: "EXACT_START", value: null }
    : { code: "SHIFTED_START", value: candidate.timeShiftMinutes }];
  if (candidate.addedOrphanedMinutes < 0) values.push({ code: "REDUCES_FRAGMENTATION", value: Math.abs(candidate.addedOrphanedMinutes) });
  else if (candidate.addedOrphanedMinutes === 0) values.push({ code: "PRESERVES_SCHEDULE", value: 0 });
  else values.push({ code: "CREATES_SHORT_GAP", value: candidate.addedOrphanedMinutes });
  if (candidate.totalPriceRub === minimumPrice) values.push({ code: "LOWEST_PRICE", value: candidate.totalPriceRub });
  if (candidate.capacitySlackRatio <= 0.25) values.push({ code: "CAPACITY_MATCH", value: candidate.totalCapacity });
  if ((candidate.roomSet.rooms.flatMap((room) => room.priceRules ?? [])).some((rule) => rule.active)) values.push({ code: "DYNAMIC_PRICE", value: candidate.roomPriceRub });
  return values;
}

export function planBooking(request: PlanningRequest): PlanningResult {
  validateRequest(request);
  const weights = normalizedWeights(request.weights);
  const generated = request.roomSets.map((roomSet) => candidatesForRoomSet(request, roomSet));
  const candidates = generated.flatMap((item) => item.candidates);
  const minimumPrice = candidates.length ? Math.min(...candidates.map((item) => item.totalPriceRub)) : 0;
  const ranked = candidates.map((candidate) => {
    const timeShift = component(candidate.timeShiftMinutes, clamp(candidate.timeShiftMinutes / 720), weights.timeShift, "minutes");
    const fragmentation = component(candidate.addedOrphanedMinutes, clamp((candidate.addedOrphanedMinutes + 120) / 360), weights.fragmentation, "minutes");
    const price = component(candidate.totalPriceRub, priceNormalized(candidate, candidates, request.maxTotalPriceRub), weights.price, "rub");
    const capacitySlack = component(candidate.capacitySlackRatio, clamp(candidate.capacitySlackRatio), weights.capacitySlack, "ratio");
    const components = { timeShift, fragmentation, price, capacitySlack };
    return {
      candidate,
      components,
      score: rounded(Object.values(components).reduce((sum, item) => sum + item.contribution, 0)),
    };
  }).sort((left, right) => left.score - right.score
    || left.candidate.timeShiftMinutes - right.candidate.timeShiftMinutes
    || left.candidate.totalPriceRub - right.candidate.totalPriceRub
    || left.candidate.startsAt.localeCompare(right.candidate.startsAt)
    || left.candidate.roomSet.id.localeCompare(right.candidate.roomSet.id));
  const maxVariants = request.maxVariants ?? 10;
  const roomSetCounts = new Map<string, number>();
  const visibleRanked = request.maxVariantsPerRoomSet === undefined ? ranked : ranked.filter(({ candidate }) => {
    const count = roomSetCounts.get(candidate.roomSet.id) ?? 0;
    if (count >= request.maxVariantsPerRoomSet!) return false;
    roomSetCounts.set(candidate.roomSet.id, count + 1);
    return true;
  });
  return {
    algorithmVersion: ROOMS_PLANNER_VERSION,
    constraintSetHash: constraintHash(request, weights),
    candidatesEvaluated: candidates.length,
    exactCandidateAvailable: candidates.some((candidate) => candidate.exactStart),
    variants: visibleRanked.slice(0, maxVariants).map(({ candidate, components, score }, index) => ({
      rank: index + 1,
      roomSetId: candidate.roomSet.id,
      roomIds: candidate.roomSet.rooms.map((room) => room.id),
      startsAt: candidate.startsAt,
      maximumDurationMinutes: candidate.maximumDurationMinutes,
      exactStart: candidate.exactStart,
      totalPriceRub: candidate.totalPriceRub,
      roomPriceRub: candidate.roomPriceRub,
      servicesPriceRub: candidate.servicesPriceRub,
      totalCapacity: candidate.totalCapacity,
      score,
      components,
      reasons: [
        ...reasons(candidate, minimumPrice),
        ...((request.requiredFeatures?.length ?? 0) ? [{ code: "REQUIRED_FEATURES_MATCH" as const, value: request.requiredFeatures!.length }] : []),
        ...((request.requestedServiceIds?.length ?? 0) ? [{ code: "SERVICES_INCLUDED" as const, value: request.requestedServiceIds!.length }] : []),
      ],
    })),
    rejections: generated.flatMap((item) => item.rejection ? [item.rejection] : []),
  };
}

export function planningCandidateKeys(request: PlanningRequest): string[] {
  validateRequest(request);
  return request.roomSets
    .flatMap((roomSet) => candidatesForRoomSet(request, roomSet).candidates)
    .map((candidate) => planningCandidateKey(candidate.roomSet.id, candidate.startsAt))
    .sort((left, right) => left.localeCompare(right));
}
