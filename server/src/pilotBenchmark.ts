import {
  evaluateGrantScenario,
  evaluateRoomsScenario,
  type GrantBenchmarkStrategy,
  type GrantBenchmarkScenario,
  type GrantScenarioEvaluation,
  type GrantStrategySummary,
} from "./grantBenchmark.js";
import type { PilotDataset, PilotRequest, PilotRoom } from "./pilotDataset.js";
import type { HourInterval, Room } from "./types.js";

export const PILOT_BENCHMARK_SCHEMA_VERSION = 1;

export interface PilotStrategySummary extends GrantStrategySummary {
  historicalSelectionComparable: number;
  historicalSelectionMatches: number;
  historicalSelectionMatchRate: number;
}

export interface PilotBenchmarkReport {
  schemaVersion: number;
  dataSource: "pilot_anonymized";
  datasetHash: string;
  scenarioCount: number;
  capacityEligibleScenarios: number;
  capacityExcludedScenarios: number;
  knownRecordedAvailability: number;
  reconstructedAvailabilityMatches: number;
  reconstructedAvailabilityAgreementRate: number;
  futureBlockComparisonsIgnored: number;
  releasedBlockComparisonsIgnored: number;
  strategies: PilotStrategySummary[];
}

interface EvaluatedRequest {
  request: PilotRequest;
  capacityEligible: boolean;
  firstAvailable: GrantScenarioEvaluation;
  preferredNearest: GrantScenarioEvaluation;
  roomsMulticriteria: GrantScenarioEvaluation;
  futureBlocksIgnored: number;
  releasedBlocksIgnored: number;
}

function clockMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function operatingMinutes(room: PilotRoom): [number, number] {
  const opens = clockMinutes(room.opensAt);
  let closes = clockMinutes(room.closesAt);
  if (closes <= opens) closes += 1440;
  return [opens, closes];
}

function relativeStart(room: PilotRoom, startsAt: string): number {
  const [opens, closes] = operatingMinutes(room);
  let start = clockMinutes(startsAt);
  if (closes > 1440 && start < opens) start += 1440;
  return start;
}

function activeBlocksForRequest(dataset: PilotDataset, room: PilotRoom, request: PilotRequest): {
  intervals: HourInterval[];
  futureIgnored: number;
  releasedIgnored: number;
} {
  const requestTime = Date.parse(request.createdAt);
  const relevant = dataset.blocks.filter((block) => block.roomCode === room.roomCode && block.eventDate === request.eventDate);
  let futureIgnored = 0;
  let releasedIgnored = 0;
  const intervals: HourInterval[] = [];
  const [opens, closes] = operatingMinutes(room);
  for (const block of relevant) {
    if (Date.parse(block.recordedAt) > requestTime) {
      futureIgnored += 1;
      continue;
    }
    if (block.releasedAt && Date.parse(block.releasedAt) <= requestTime) {
      releasedIgnored += 1;
      continue;
    }
    const start = Math.max(opens, relativeStart(room, block.startsAt) - room.bufferBeforeMinutes);
    const end = Math.min(closes, relativeStart(room, block.startsAt) + block.durationMinutes + room.bufferAfterMinutes);
    if (end > start) intervals.push([start / 60, end / 60]);
  }
  return { intervals, futureIgnored, releasedIgnored };
}

function benchmarkRoom(dataset: PilotDataset, pilotRoom: PilotRoom, request: PilotRequest): {
  room: Room;
  futureIgnored: number;
  releasedIgnored: number;
} {
  const [opens, closes] = operatingMinutes(pilotRoom);
  const blocks = activeBlocksForRequest(dataset, pilotRoom, request);
  return {
    room: {
      id: pilotRoom.roomCode,
      slug: pilotRoom.roomCode.toLowerCase(),
      venueId: pilotRoom.venueCode,
      title: pilotRoom.roomCode,
      subtitle: "Обезличенное пилотное помещение",
      type: pilotRoom.roomType,
      capacityMin: pilotRoom.capacityMin,
      capacityMax: pilotRoom.capacityMax,
      pricePerHour: pilotRoom.pricePerHourRub,
      minimumHours: pilotRoom.minimumDurationMinutes / 60,
      rating: 0,
      reviewCount: 0,
      description: "Используется только в обезличенном пилотном испытании Rooms.",
      rules: "Персональные данные не требуются.",
      promotion: null,
      features: [],
      tags: [],
      photoPaths: [],
      services: [],
      opensAtHour: opens / 60,
      closesAtHour: closes / 60,
      bufferMinutes: 0,
      defaultBlocked: [],
      blockedByDate: { [request.eventDate]: blocks.intervals },
      publicationStatus: "published",
    },
    futureIgnored: blocks.futureIgnored,
    releasedIgnored: blocks.releasedIgnored,
  };
}

function unavailableEvaluation(requestCode: string, strategy: GrantBenchmarkStrategy): GrantScenarioEvaluation {
  return {
    scenarioId: requestCode,
    strategy,
    candidateCount: 0,
    exactCandidateAvailable: false,
    selectedStartsAt: null,
    exactSelected: false,
    absoluteShiftMinutes: null,
    addedOrphanedMinutes: null,
  };
}

function evaluateRequest(dataset: PilotDataset, request: PilotRequest): EvaluatedRequest {
  const pilotRooms = request.roomCodes.map((roomCode) => dataset.rooms.find((room) => room.roomCode === roomCode));
  if (pilotRooms.some((room) => room === undefined)) throw new Error(`Dataset ${dataset.datasetHash} has an unknown room after validation.`);
  const resolvedRooms = pilotRooms as PilotRoom[];
  const prepared = resolvedRooms.map((room) => benchmarkRoom(dataset, room, request));
  const capacityEligible = request.guestCount <= resolvedRooms.reduce((total, room) => total + room.capacityMax, 0);
  const scenario: GrantBenchmarkScenario = {
    id: request.requestCode,
    profile: resolvedRooms[0]?.venueType ?? "pilot",
    date: request.eventDate,
    preferredTime: request.preferredStart,
    durationMinutes: request.durationMinutes,
    rooms: prepared.map((item) => item.room),
    stepMinutesByRoomId: Object.fromEntries(resolvedRooms.map((room) => [room.roomCode, room.startStepMinutes])),
    bookingBufferByRoomId: Object.fromEntries(resolvedRooms.map((room) => [room.roomCode, {
      beforeMinutes: room.bufferBeforeMinutes,
      afterMinutes: room.bufferAfterMinutes,
    }])),
  };
  return {
    request,
    capacityEligible,
    firstAvailable: capacityEligible ? evaluateGrantScenario(scenario, "first_available") : unavailableEvaluation(request.requestCode, "first_available"),
    preferredNearest: capacityEligible ? evaluateGrantScenario(scenario, "preferred_nearest") : unavailableEvaluation(request.requestCode, "preferred_nearest"),
    roomsMulticriteria: capacityEligible ? evaluateRoomsScenario(scenario) : unavailableEvaluation(request.requestCode, "rooms_multicriteria_v1"),
    futureBlocksIgnored: prepared.reduce((total, item) => total + item.futureIgnored, 0),
    releasedBlocksIgnored: prepared.reduce((total, item) => total + item.releasedIgnored, 0),
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function selectedClock(startsAt: string | null): string | null {
  return startsAt?.slice(11, 16) ?? null;
}

function evaluationFor(item: EvaluatedRequest, strategy: GrantBenchmarkStrategy): GrantScenarioEvaluation {
  if (strategy === "first_available") return item.firstAvailable;
  if (strategy === "preferred_nearest") return item.preferredNearest;
  return item.roomsMulticriteria;
}

function summarize(evaluated: EvaluatedRequest[], strategy: GrantBenchmarkStrategy): PilotStrategySummary {
  const evaluations = evaluated.map((item) => evaluationFor(item, strategy));
  const selected = evaluations.filter((item) => item.selectedStartsAt !== null);
  const alternatives = selected.filter((item) => !item.exactCandidateAvailable);
  const exactSelections = selected.filter((item) => item.exactSelected).length;
  const comparable = evaluated.filter((item) => item.capacityEligible && item.request.selectedStart !== null);
  const matches = comparable.filter((item) => {
    const evaluation = evaluationFor(item, strategy);
    return selectedClock(evaluation.selectedStartsAt) === item.request.selectedStart;
  }).length;
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
    historicalSelectionComparable: comparable.length,
    historicalSelectionMatches: matches,
    historicalSelectionMatchRate: rounded(comparable.length ? matches / comparable.length : 0),
  };
}

export function buildPilotBenchmarkReport(dataset: PilotDataset): PilotBenchmarkReport {
  const evaluated = dataset.requests.map((request) => evaluateRequest(dataset, request));
  const known = evaluated.filter((item) => item.request.exactStartAvailable !== "unknown" && item.capacityEligible);
  const reconstructedMatches = known.filter((item) => item.preferredNearest.exactCandidateAvailable === item.request.exactStartAvailable).length;
  const eligible = evaluated.filter((item) => item.capacityEligible).length;
  return {
    schemaVersion: PILOT_BENCHMARK_SCHEMA_VERSION,
    dataSource: "pilot_anonymized",
    datasetHash: dataset.datasetHash,
    scenarioCount: evaluated.length,
    capacityEligibleScenarios: eligible,
    capacityExcludedScenarios: evaluated.length - eligible,
    knownRecordedAvailability: known.length,
    reconstructedAvailabilityMatches: reconstructedMatches,
    reconstructedAvailabilityAgreementRate: rounded(known.length ? reconstructedMatches / known.length : 0),
    futureBlockComparisonsIgnored: evaluated.reduce((total, item) => total + item.futureBlocksIgnored, 0),
    releasedBlockComparisonsIgnored: evaluated.reduce((total, item) => total + item.releasedBlocksIgnored, 0),
    strategies: [
      summarize(evaluated, "first_available"),
      summarize(evaluated, "preferred_nearest"),
      summarize(evaluated, "rooms_multicriteria_v1"),
    ],
  };
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function strategyName(strategy: GrantBenchmarkStrategy): string {
  if (strategy === "first_available") return "Первое доступное окно";
  if (strategy === "preferred_nearest") return "Ближайшее к желаемому времени";
  return "Rooms, многокритериальная версия 0.1";
}

export function pilotBenchmarkMarkdown(report: PilotBenchmarkReport, generatedAt = new Date().toISOString()): string {
  const rows = report.strategies.map((strategy) => `| ${strategyName(strategy.strategy)} | ${strategy.selectedScenarios} | ${percent(strategy.exactSelectionRate)} | ${strategy.meanAbsoluteShiftMinutes} мин | ${strategy.meanAddedOrphanedMinutes} мин | ${percent(strategy.historicalSelectionMatchRate)} |`).join("\n");
  return `# Базовые стратегии на пилотном наборе Rooms

Дата формирования: ${generatedAt}

> Расчёт выполнен на обезличенном наборе с SHA-256 \`${report.datasetHash}\`. Это диагностическая базовая линия, а не доказательство улучшения метрик новым алгоритмом Rooms.

## Контроль набора

- запросов: ${report.scenarioCount};
- прошли ограничение вместимости: ${report.capacityEligibleScenarios};
- исключены по вместимости: ${report.capacityExcludedScenarios};
- запросов с зафиксированной доступностью точного времени: ${report.knownRecordedAvailability};
- совпадений реконструкции с записью площадки: ${report.reconstructedAvailabilityMatches} (${percent(report.reconstructedAvailabilityAgreementRate)});
- сравнений с блоками, созданными после запроса и исключёнными из расчёта: ${report.futureBlockComparisonsIgnored};
- сравнений со снятыми к моменту запроса блоками и исключёнными из расчёта: ${report.releasedBlockComparisonsIgnored}.

## Результаты

| Стратегия | Найден вариант | Точное начало | Средний сдвиг | Добавлено коротких интервалов | Совпадение с историческим выбором |
| --- | ---: | ---: | ---: | ---: | ---: |
${rows}

## Как читать результат

Для каждого запроса календарь восстанавливается на момент \`created_at\`: будущие блоки не учитываются, а уже снятые удержания исключаются. Буферы до и после занятости применяются по правилам помещения. Если совпадение реконструированной доступности с записью площадки низкое, сначала исправляется качество данных и только затем сравниваются алгоритмы.

Совпадение с историческим выбором не означает, что стратегия лучше: сотрудник мог учитывать причины, которых нет в наборе. Эффект алгоритма Rooms оформляется отдельным парным сравнением на тех же запросах и с тем же хешем данных.
`;
}
