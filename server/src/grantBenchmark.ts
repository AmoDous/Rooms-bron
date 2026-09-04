import { availabilityForRoom, intersectAvailability } from "./availability.js";
import { planBooking } from "./planning.js";
import type { AvailabilityWindow, HourInterval, Room } from "./types.js";

export const GRANT_BENCHMARK_FIXTURE_VERSION = 1;
export const GRANT_BENCHMARK_DATE = "2026-07-15";

export type GrantBaselineStrategy = "first_available" | "preferred_nearest";
export type GrantBenchmarkStrategy = GrantBaselineStrategy | "rooms_multicriteria_v1";

export interface GrantBenchmarkScenario {
  id: string;
  profile: string;
  date: string;
  preferredTime: string;
  durationMinutes: number;
  rooms: Room[];
  stepMinutesByRoomId?: Record<string, number>;
  bookingBufferByRoomId?: Record<string, { beforeMinutes: number; afterMinutes: number }>;
}

export interface GrantScenarioEvaluation {
  scenarioId: string;
  strategy: GrantBenchmarkStrategy;
  candidateCount: number;
  exactCandidateAvailable: boolean;
  selectedStartsAt: string | null;
  exactSelected: boolean;
  absoluteShiftMinutes: number | null;
  addedOrphanedMinutes: number | null;
}

export interface GrantStrategySummary {
  strategy: GrantBenchmarkStrategy;
  selectedScenarios: number;
  exactSelections: number;
  exactSelectionRate: number;
  alternativeOpportunities: number;
  alternativesReturned: number;
  alternativeCoverageRate: number;
  meanAbsoluteShiftMinutes: number;
  meanAddedOrphanedMinutes: number;
}

export interface GrantBenchmarkReport {
  fixtureVersion: number;
  dataSource: "synthetic";
  scenarioCount: number;
  feasibleScenarios: number;
  infeasibleScenarios: number;
  exactCandidateScenarios: number;
  profiles: string[];
  strategies: GrantStrategySummary[];
  experimentalComparison: {
    reference: "preferred_nearest";
    contender: "rooms_multicriteria_v1";
    meanShiftDifferenceMinutes: number;
    exactSelectionRateDifference: number;
    meanAddedOrphanedDifferenceMinutes: number;
    addedOrphanedReductionRate: number;
  };
}

interface RoomFixture {
  opensAtHour: number;
  closesAtHour: number;
  blocked: HourInterval[];
}

interface ProfileFixture {
  id: string;
  rooms: RoomFixture[];
}

const preferredTimes = ["10:00", "12:00", "15:00", "18:00", "21:00"] as const;
const durations = [120, 180, 240] as const;

const profileFixtures: ProfileFixture[] = [
  { id: "open-day", rooms: [{ opensAtHour: 10, closesAtHour: 24, blocked: [] }] },
  { id: "split-midday", rooms: [{ opensAtHour: 10, closesAtHour: 24, blocked: [[13, 15]] }] },
  { id: "evening-peak", rooms: [{ opensAtHour: 10, closesAtHour: 24, blocked: [[12, 16], [20, 22]] }] },
  { id: "fragmented-day", rooms: [{ opensAtHour: 9, closesAtHour: 23, blocked: [[11, 12.5], [15, 16], [19, 21]] }] },
  {
    id: "two-room-common",
    rooms: [
      { opensAtHour: 10, closesAtHour: 24, blocked: [[14, 16]] },
      { opensAtHour: 10, closesAtHour: 24, blocked: [[10, 12], [18, 20]] },
    ],
  },
  {
    id: "two-room-tight",
    rooms: [
      { opensAtHour: 10, closesAtHour: 24, blocked: [[13, 15], [20, 22]] },
      { opensAtHour: 10, closesAtHour: 24, blocked: [[11, 13], [17, 20]] },
    ],
  },
  {
    id: "three-room-event",
    rooms: [
      { opensAtHour: 10, closesAtHour: 24, blocked: [[12, 14]] },
      { opensAtHour: 10, closesAtHour: 24, blocked: [[15, 17]] },
      { opensAtHour: 10, closesAtHour: 24, blocked: [[10, 12], [20, 22]] },
    ],
  },
  { id: "short-day", rooms: [{ opensAtHour: 10, closesAtHour: 20, blocked: [[12, 14], [17, 19]] }] },
];

function benchmarkRoom(profile: string, roomIndex: number, fixture: RoomFixture): Room {
  return {
    id: `benchmark-${profile}-${roomIndex + 1}`,
    slug: `benchmark-${profile}-${roomIndex + 1}`,
    venueId: `benchmark-venue-${profile}`,
    title: `Тестовое помещение ${roomIndex + 1}`,
    subtitle: "Синтетический сценарий",
    type: "benchmark",
    capacityMin: 1,
    capacityMax: 40,
    pricePerHour: 1600,
    minimumHours: 2,
    rating: 0,
    reviewCount: 0,
    description: "Используется только в воспроизводимом стенде испытаний Rooms.",
    rules: "Синтетические данные.",
    promotion: null,
    features: [],
    tags: [],
    photoPaths: [],
    services: [],
    opensAtHour: fixture.opensAtHour,
    closesAtHour: fixture.closesAtHour,
    bufferMinutes: 0,
    defaultBlocked: fixture.blocked,
    blockedByDate: {},
    publicationStatus: "published",
  };
}

export function grantBenchmarkScenarios(): GrantBenchmarkScenario[] {
  return profileFixtures.flatMap((profile) => {
    const rooms = profile.rooms.map((fixture, index) => benchmarkRoom(profile.id, index, fixture));
    return preferredTimes.flatMap((preferredTime) => durations.map((durationMinutes) => ({
      id: `${profile.id}-${preferredTime.replace(":", "")}-${durationMinutes}`,
      profile: profile.id,
      date: GRANT_BENCHMARK_DATE,
      preferredTime,
      durationMinutes,
      rooms,
    })));
  });
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

function preferredOffsetMinutes(scenario: GrantBenchmarkScenario): number {
  const preferred = clockMinutes(scenario.preferredTime);
  const earliestOpening = Math.min(...scenario.rooms.map((room) => room.opensAtHour * 60));
  const crossesMidnight = scenario.rooms.some((room) => room.closesAtHour > 24);
  return crossesMidnight && preferred < earliestOpening ? preferred + 1440 : preferred;
}

function windowsForScenario(scenario: GrantBenchmarkScenario): AvailabilityWindow[] {
  const roomWindows = scenario.rooms.map((room) => availabilityForRoom(
    room,
    scenario.date,
    scenario.durationMinutes,
    scenario.preferredTime,
    scenario.stepMinutesByRoomId?.[room.id] ?? 30,
    scenario.bookingBufferByRoomId?.[room.id]?.beforeMinutes ?? 0,
    scenario.bookingBufferByRoomId?.[room.id]?.afterMinutes ?? 0,
  ));
  return intersectAvailability(roomWindows, scenario.durationMinutes, scenario.preferredTime);
}

function chooseWindow(
  scenario: GrantBenchmarkScenario,
  windows: AvailabilityWindow[],
  strategy: GrantBaselineStrategy,
): AvailabilityWindow | null {
  if (!windows.length) return null;
  if (strategy === "first_available") return windows[0] ?? null;
  const preferred = preferredOffsetMinutes(scenario);
  return [...windows].sort((left, right) => {
    const leftShift = Math.abs(startOffsetMinutes(scenario.date, left.startsAt) - preferred);
    const rightShift = Math.abs(startOffsetMinutes(scenario.date, right.startsAt) - preferred);
    return leftShift - rightShift || left.startsAt.localeCompare(right.startsAt);
  })[0] ?? null;
}

function mergeMinuteIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) {
      merged.push([...interval]);
    } else {
      previous[1] = Math.max(previous[1], interval[1]);
    }
  }
  return merged;
}

function orphanedMinutes(room: Room, date: string, extraBlock?: [number, number]): number {
  const opens = room.opensAtHour * 60;
  const closes = room.closesAtHour * 60;
  const minimumDuration = room.minimumHours * 60;
  const blocks: Array<[number, number]> = [
    ...room.defaultBlocked,
    ...(room.blockedByDate[date] ?? []),
  ].map(([start, end]) => [Math.max(opens, start * 60), Math.min(closes, end * 60)]);
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

function addedOrphanedMinutes(scenario: GrantBenchmarkScenario, startsAt: string): number {
  const start = startOffsetMinutes(scenario.date, startsAt);
  return scenario.rooms.reduce((total, room) => {
    const buffer = scenario.bookingBufferByRoomId?.[room.id];
    const booking: [number, number] = [
      start - (buffer?.beforeMinutes ?? 0),
      start + scenario.durationMinutes + (buffer?.afterMinutes ?? 0),
    ];
    const before = orphanedMinutes(room, scenario.date);
    const after = orphanedMinutes(room, scenario.date, booking);
    return total + after - before;
  }, 0);
}

export function evaluateGrantScenario(
  scenario: GrantBenchmarkScenario,
  strategy: GrantBaselineStrategy,
): GrantScenarioEvaluation {
  const windows = windowsForScenario(scenario);
  const selected = chooseWindow(scenario, windows, strategy);
  if (!selected) {
    return {
      scenarioId: scenario.id,
      strategy,
      candidateCount: 0,
      exactCandidateAvailable: false,
      selectedStartsAt: null,
      exactSelected: false,
      absoluteShiftMinutes: null,
      addedOrphanedMinutes: null,
    };
  }
  const preferred = preferredOffsetMinutes(scenario);
  const selectedOffset = startOffsetMinutes(scenario.date, selected.startsAt);
  return {
    scenarioId: scenario.id,
    strategy,
    candidateCount: windows.length,
    exactCandidateAvailable: windows.some((window) => window.exactMatch),
    selectedStartsAt: selected.startsAt,
    exactSelected: selected.exactMatch,
    absoluteShiftMinutes: Math.abs(selectedOffset - preferred),
    addedOrphanedMinutes: addedOrphanedMinutes(scenario, selected.startsAt),
  };
}

export function evaluateRoomsScenario(scenario: GrantBenchmarkScenario): GrantScenarioEvaluation {
  const result = planBooking({
    date: scenario.date,
    preferredTime: scenario.preferredTime,
    durationMinutes: scenario.durationMinutes,
    guests: 1,
    roomSets: [{
      id: scenario.id,
      rooms: scenario.rooms,
      ...(scenario.stepMinutesByRoomId ? { stepMinutesByRoomId: scenario.stepMinutesByRoomId } : {}),
      ...(scenario.bookingBufferByRoomId ? { bookingBufferByRoomId: scenario.bookingBufferByRoomId } : {}),
    }],
    maxVariants: 1,
  });
  const selected = result.variants[0];
  return {
    scenarioId: scenario.id,
    strategy: "rooms_multicriteria_v1",
    candidateCount: result.candidatesEvaluated,
    exactCandidateAvailable: result.exactCandidateAvailable,
    selectedStartsAt: selected?.startsAt ?? null,
    exactSelected: selected?.exactStart ?? false,
    absoluteShiftMinutes: selected?.components.timeShift.raw ?? null,
    addedOrphanedMinutes: selected?.components.fragmentation.raw ?? null,
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function summarizeStrategy(
  evaluations: GrantScenarioEvaluation[],
  strategy: GrantBenchmarkStrategy,
): GrantStrategySummary {
  const selected = evaluations.filter((item) => item.selectedStartsAt !== null);
  const alternatives = selected.filter((item) => !item.exactCandidateAvailable);
  const exactSelections = selected.filter((item) => item.exactSelected).length;
  return {
    strategy,
    selectedScenarios: selected.length,
    exactSelections,
    exactSelectionRate: rounded(selected.length ? exactSelections / selected.length : 0),
    alternativeOpportunities: alternatives.length,
    alternativesReturned: alternatives.length,
    alternativeCoverageRate: rounded(alternatives.length ? 1 : 0),
    meanAbsoluteShiftMinutes: rounded(mean(selected.flatMap((item) => item.absoluteShiftMinutes ?? []))),
    meanAddedOrphanedMinutes: rounded(mean(selected.flatMap((item) => item.addedOrphanedMinutes ?? []))),
  };
}

export function buildGrantBenchmarkReport(): GrantBenchmarkReport {
  const scenarios = grantBenchmarkScenarios();
  const firstAvailable = scenarios.map((scenario) => evaluateGrantScenario(scenario, "first_available"));
  const preferredNearest = scenarios.map((scenario) => evaluateGrantScenario(scenario, "preferred_nearest"));
  const roomsMulticriteria = scenarios.map((scenario) => evaluateRoomsScenario(scenario));
  const feasible = firstAvailable.filter((item) => item.selectedStartsAt !== null);
  const summaries = [
    summarizeStrategy(firstAvailable, "first_available"),
    summarizeStrategy(preferredNearest, "preferred_nearest"),
    summarizeStrategy(roomsMulticriteria, "rooms_multicriteria_v1"),
  ];
  const nearestSummary = summaries[1] as GrantStrategySummary;
  const roomsSummary = summaries[2] as GrantStrategySummary;
  return {
    fixtureVersion: GRANT_BENCHMARK_FIXTURE_VERSION,
    dataSource: "synthetic",
    scenarioCount: scenarios.length,
    feasibleScenarios: feasible.length,
    infeasibleScenarios: scenarios.length - feasible.length,
    exactCandidateScenarios: feasible.filter((item) => item.exactCandidateAvailable).length,
    profiles: profileFixtures.map((profile) => profile.id),
    strategies: summaries,
    experimentalComparison: {
      reference: "preferred_nearest",
      contender: "rooms_multicriteria_v1",
      meanShiftDifferenceMinutes: rounded(roomsSummary.meanAbsoluteShiftMinutes - nearestSummary.meanAbsoluteShiftMinutes),
      exactSelectionRateDifference: rounded(roomsSummary.exactSelectionRate - nearestSummary.exactSelectionRate),
      meanAddedOrphanedDifferenceMinutes: rounded(roomsSummary.meanAddedOrphanedMinutes - nearestSummary.meanAddedOrphanedMinutes),
      addedOrphanedReductionRate: rounded(nearestSummary.meanAddedOrphanedMinutes
        ? (nearestSummary.meanAddedOrphanedMinutes - roomsSummary.meanAddedOrphanedMinutes) / Math.abs(nearestSummary.meanAddedOrphanedMinutes)
        : 0),
    },
  };
}
