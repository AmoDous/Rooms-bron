import { createHash } from "node:crypto";
import {
  planBooking,
  planningCandidateKey,
  planningCandidateKeys,
  type PlanningRequest,
  type PlanningRoomSet,
} from "./planning.js";
import type { HourInterval, Room } from "./types.js";

export const PLANNING_ORACLE_VERSION = 1;
export const PLANNING_ORACLE_FIXTURE_SEED = 20_260_902;
export const PLANNING_ORACLE_DATE = "2026-07-15";

export interface PlanningOracleComparison {
  complete: boolean;
  plannerCandidateCount: number;
  oracleCandidateCount: number;
  missingCandidateKeys: string[];
  unexpectedCandidateKeys: string[];
}

export interface PlanningOracleScenario {
  id: string;
  request: PlanningRequest;
}

export interface PlanningOracleFailure {
  scenarioId: string;
  missingCandidateKeys: string[];
  unexpectedCandidateKeys: string[];
}

export interface PlanningOracleReport {
  oracleVersion: number;
  dataSource: "synthetic";
  seed: number;
  datasetHash: string;
  scenarioCount: number;
  completeScenarios: number;
  failedScenarios: number;
  plannerCandidateCount: number;
  oracleCandidateCount: number;
  missingCandidateCount: number;
  unexpectedCandidateCount: number;
  failures: PlanningOracleFailure[];
}

function clockMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function clockFromMinutes(totalMinutes: number): string {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutesInDay / 60)).padStart(2, "0")}:${String(minutesInDay % 60).padStart(2, "0")}`;
}

function startsAt(date: string, minutes: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + Math.floor(minutes / 1440));
  return `${day.toISOString().slice(0, 10)}T${clockFromMinutes(minutes)}:00+03:00`;
}

function blocksInMinutes(room: Room, date: string): Array<[number, number]> {
  const source: HourInterval[] = [...room.defaultBlocked, ...(room.blockedByDate[date] ?? [])];
  return source
    .map(([start, end]) => [start * 60, end * 60] as [number, number])
    .filter(([start, end]) => end > start);
}

function aligned(start: number, opens: number, step: number): boolean {
  return Math.abs((start - opens) % step) < 0.000_001;
}

function roomAllows(request: PlanningRequest, roomSet: PlanningRoomSet, room: Room, start: number): boolean {
  const opens = room.opensAtHour * 60;
  const closes = room.closesAtHour * 60;
  const step = roomSet.stepMinutesByRoomId?.[room.id] ?? 30;
  if (start < opens || start + request.durationMinutes > closes || !aligned(start, opens, step)) return false;
  const buffer = roomSet.bookingBufferByRoomId?.[room.id];
  const occupiedStart = start - (buffer?.beforeMinutes ?? 0);
  const occupiedEnd = start + request.durationMinutes + (buffer?.afterMinutes ?? 0);
  return !blocksInMinutes(room, request.date).some(([blockedStart, blockedEnd]) => blockedStart < occupiedEnd && blockedEnd > occupiedStart);
}

function roomSetPassesHardConstraints(request: PlanningRequest, roomSet: PlanningRoomSet): boolean {
  const capacity = roomSet.rooms.reduce((total, room) => total + room.capacityMax, 0);
  const price = roomSet.rooms.reduce((total, room) => total + room.pricePerHour, 0) * request.durationMinutes / 60;
  if (request.guests > capacity) return false;
  if (roomSet.rooms.some((room) => request.durationMinutes < room.minimumHours * 60)) return false;
  return request.maxTotalPriceRub === undefined || price <= request.maxTotalPriceRub;
}

export function exhaustiveCandidateKeys(request: PlanningRequest): string[] {
  // planBooking performs the public contract validation before the independent enumeration.
  planBooking({ ...request, maxVariants: 1 });
  const keys: string[] = [];
  for (const roomSet of request.roomSets) {
    if (!roomSetPassesHardConstraints(request, roomSet)) continue;
    const earliest = Math.min(...roomSet.rooms.map((room) => room.opensAtHour * 60));
    const latest = Math.max(...roomSet.rooms.map((room) => room.closesAtHour * 60));
    for (let start = earliest; start <= latest; start += 15) {
      if (roomSet.rooms.every((room) => roomAllows(request, roomSet, room, start))) {
        keys.push(planningCandidateKey(roomSet.id, startsAt(request.date, start)));
      }
    }
  }
  return keys.sort((left, right) => left.localeCompare(right));
}

export function comparePlannerWithOracle(request: PlanningRequest): PlanningOracleComparison {
  const planner = planningCandidateKeys(request);
  const oracle = exhaustiveCandidateKeys(request);
  const plannerSet = new Set(planner);
  const oracleSet = new Set(oracle);
  const missingCandidateKeys = oracle.filter((key) => !plannerSet.has(key));
  const unexpectedCandidateKeys = planner.filter((key) => !oracleSet.has(key));
  return {
    complete: missingCandidateKeys.length === 0 && unexpectedCandidateKeys.length === 0,
    plannerCandidateCount: planner.length,
    oracleCandidateCount: oracle.length,
    missingCandidateKeys,
    unexpectedCandidateKeys,
  };
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function fixtureRoom(
  scenarioIndex: number,
  setIndex: number,
  roomIndex: number,
  random: () => number,
): { room: Room; step: 15 | 30 | 60; before: number; after: number } {
  const opens = choose(random, [9, 10, 11, 12] as const);
  const closes = opens + choose(random, [8, 10, 12, 14] as const);
  const blockCount = Math.floor(random() * 3);
  const blocks: HourInterval[] = [];
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const start = opens + 1 + Math.floor(random() * Math.max(1, closes - opens - 3));
    const duration = choose(random, [1, 1.5, 2] as const);
    blocks.push([start, Math.min(closes, start + duration)]);
  }
  const id = `oracle-${scenarioIndex + 1}-${setIndex + 1}-${roomIndex + 1}`;
  return {
    room: {
      id,
      slug: id,
      venueId: `oracle-venue-${scenarioIndex + 1}-${setIndex + 1}`,
      title: `Синтетическое помещение ${roomIndex + 1}`,
      subtitle: "Эталонный перебор",
      type: "oracle",
      capacityMin: 1,
      capacityMax: choose(random, [6, 10, 15, 20] as const),
      pricePerHour: choose(random, [1000, 1500, 2200, 3000] as const),
      minimumHours: choose(random, [1, 1.5, 2] as const),
      rating: 0,
      reviewCount: 0,
      description: "Только синтетические данные.",
      rules: "Только для проверки полноты.",
      promotion: null,
      features: [],
      tags: [],
      photoPaths: [],
      services: [],
      opensAtHour: opens,
      closesAtHour: closes,
      bufferMinutes: 0,
      defaultBlocked: blocks,
      blockedByDate: {},
      publicationStatus: "published",
    },
    step: choose(random, [15, 30, 60] as const),
    before: choose(random, [0, 15, 30] as const),
    after: choose(random, [0, 15, 30] as const),
  };
}

export function planningOracleScenarios(count = 300, seed = PLANNING_ORACLE_FIXTURE_SEED): PlanningOracleScenario[] {
  const random = lcg(seed);
  return Array.from({ length: count }, (_, scenarioIndex) => {
    const roomSetCount = 1 + Math.floor(random() * 3);
    const roomSets: PlanningRoomSet[] = Array.from({ length: roomSetCount }, (_, setIndex) => {
      const roomCount = 1 + Math.floor(random() * 3);
      const fixtures = Array.from({ length: roomCount }, (_, roomIndex) => fixtureRoom(scenarioIndex, setIndex, roomIndex, random));
      return {
        id: `set-${setIndex + 1}`,
        rooms: fixtures.map((fixture) => fixture.room),
        stepMinutesByRoomId: Object.fromEntries(fixtures.map((fixture) => [fixture.room.id, fixture.step])),
        bookingBufferByRoomId: Object.fromEntries(fixtures.map((fixture) => [fixture.room.id, {
          beforeMinutes: fixture.before,
          afterMinutes: fixture.after,
        }])),
      };
    });
    const durationMinutes = choose(random, [60, 90, 120, 180] as const);
    const request: PlanningRequest = {
      date: PLANNING_ORACLE_DATE,
      preferredTime: choose(random, ["01:00", "10:00", "12:00", "15:00", "18:00", "21:00"] as const),
      durationMinutes,
      guests: choose(random, [2, 6, 10, 16, 24, 35] as const),
      roomSets,
      maxVariants: 10,
      ...(random() < 0.35 ? { maxTotalPriceRub: choose(random, [3000, 6000, 10_000, 18_000] as const) } : {}),
    };
    return { id: `oracle-scenario-${String(scenarioIndex + 1).padStart(3, "0")}`, request };
  });
}

export function buildPlanningOracleReport(scenarios = planningOracleScenarios()): PlanningOracleReport {
  const comparisons = scenarios.map((scenario) => ({ scenario, comparison: comparePlannerWithOracle(scenario.request) }));
  const failures = comparisons.flatMap(({ scenario, comparison }) => comparison.complete ? [] : [{
    scenarioId: scenario.id,
    missingCandidateKeys: comparison.missingCandidateKeys,
    unexpectedCandidateKeys: comparison.unexpectedCandidateKeys,
  }]);
  return {
    oracleVersion: PLANNING_ORACLE_VERSION,
    dataSource: "synthetic",
    seed: PLANNING_ORACLE_FIXTURE_SEED,
    datasetHash: createHash("sha256").update(JSON.stringify(scenarios)).digest("hex"),
    scenarioCount: scenarios.length,
    completeScenarios: scenarios.length - failures.length,
    failedScenarios: failures.length,
    plannerCandidateCount: comparisons.reduce((total, item) => total + item.comparison.plannerCandidateCount, 0),
    oracleCandidateCount: comparisons.reduce((total, item) => total + item.comparison.oracleCandidateCount, 0),
    missingCandidateCount: failures.reduce((total, item) => total + item.missingCandidateKeys.length, 0),
    unexpectedCandidateCount: failures.reduce((total, item) => total + item.unexpectedCandidateKeys.length, 0),
    failures,
  };
}
