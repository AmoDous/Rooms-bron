import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  buildGrantBenchmarkReport,
  evaluateGrantScenario,
  evaluateRoomsScenario,
  grantBenchmarkScenarios,
  type GrantBenchmarkStrategy,
  type GrantStrategySummary,
} from "../src/grantBenchmark.js";

const strategies: GrantBenchmarkStrategy[] = ["first_available", "preferred_nearest", "rooms_multicriteria_v1"];
const iterations = Math.max(50, Number.parseInt(process.env.ROOMS_BENCHMARK_ITERATIONS ?? "500", 10) || 500);
const scenarios = grantBenchmarkScenarios();

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function evaluate(scenario: (typeof scenarios)[number], strategy: GrantBenchmarkStrategy) {
  return strategy === "rooms_multicriteria_v1" ? evaluateRoomsScenario(scenario) : evaluateGrantScenario(scenario, strategy);
}

function latency(strategy: GrantBenchmarkStrategy): { p50Microseconds: number; p95Microseconds: number } {
  for (const scenario of scenarios) evaluate(scenario, strategy);
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    for (const scenario of scenarios) evaluate(scenario, strategy);
    samples.push(((performance.now() - started) * 1000) / scenarios.length);
  }
  return {
    p50Microseconds: Math.round(percentile(samples, 0.5) * 1000) / 1000,
    p95Microseconds: Math.round(percentile(samples, 0.95) * 1000) / 1000,
  };
}

function strategyLabel(strategy: GrantBenchmarkStrategy): string {
  if (strategy === "first_available") return "Первое доступное окно";
  if (strategy === "preferred_nearest") return "Ближайшее к желаемому времени";
  return "Rooms, многокритериальная версия 0.1";
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function row(summary: GrantStrategySummary & ReturnType<typeof latency>): string {
  return `| ${strategyLabel(summary.strategy)} | ${summary.selectedScenarios} | ${percent(summary.exactSelectionRate)} | ${percent(summary.alternativeCoverageRate)} | ${summary.meanAbsoluteShiftMinutes} мин | ${summary.meanAddedOrphanedMinutes} мин | ${summary.p50Microseconds} мкс |`;
}

const report = buildGrantBenchmarkReport();
const datasetHash = createHash("sha256").update(JSON.stringify(scenarios)).digest("hex");
const measuredStrategies = report.strategies.map((summary) => ({ ...summary, ...latency(summary.strategy) }));
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  dataNotice: "Synthetic benchmark only. This is not pilot, customer or sales data.",
  datasetHash,
  iterations,
  runtime: { node: process.version, platform: platform(), release: release(), architecture: arch() },
  report: { ...report, strategies: measuredStrategies },
};

const markdown = `# Синтетическая базовая линия Rooms

Дата формирования: ${artifact.generatedAt}

> Это результат воспроизводимого испытания на синтетических расписаниях. Он не является статистикой клиентов, площадок, продаж или пилотного внедрения.

## Набор испытаний

- версия набора: ${report.fixtureVersion};
- сценариев: ${report.scenarioCount};
- профилей расписания: ${report.profiles.length};
- выполнимых запросов: ${report.feasibleScenarios};
- невыполнимых запросов: ${report.infeasibleScenarios};
- хеш набора SHA-256: \`${datasetHash}\`;
- повторов замера производительности: ${iterations}.

## Результаты

| Стратегия | Найдено вариантов | Выбрано точное время | Возвращена допустимая альтернатива | Средний сдвиг | Добавлено коротких интервалов | P50 на сценарий |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${measuredStrategies.map(row).join("\n")}

## Сравнение экспериментальной версии

Относительно стратегии «ближайшее к желаемому времени» версия Rooms 0.1:

- изменила средний сдвиг на ${report.experimentalComparison.meanShiftDifferenceMinutes} мин;
- изменила долю точных выборов на ${Math.round(report.experimentalComparison.exactSelectionRateDifference * 1000) / 10} процентного пункта;
- изменила среднее количество добавленных коротких интервалов на ${report.experimentalComparison.meanAddedOrphanedDifferenceMinutes} мин;
- относительное снижение добавленной фрагментации: ${percent(report.experimentalComparison.addedOrphanedReductionRate)}.

Эти значения относятся только к зафиксированному синтетическому набору и не переносятся на реальные площадки без пилотного испытания.

## Как читать результат

«Первое доступное окно» и «ближайшее к желаемому времени» являются простыми базовыми стратегиями. «Rooms, многокритериальная версия 0.1» — экспериментальная программная реализация с фиксированными весами, а не подтверждённый научно-технический результат. Коротким считается свободный интервал меньше минимальной длительности бронирования помещения; отрицательное значение означает, что выбранная бронь устранила уже существовавший короткий разрыв.

Замеры времени зависят от компьютера и версии Node.js. Для заявки важнее воспроизводимость набора, доля точных и альтернативных решений, сдвиг от желаемого времени и изменение фрагментации. Наличие альтернативы не подтверждает понятность её объяснения — это проверяется отдельно с пользователями. Перед переносом показателей в заявку стенд нужно повторить на обезличенных календарях пилотных площадок.
`;

const jsonPath = fileURLToPath(new URL("../../docs/grants/evidence/synthetic-baseline.json", import.meta.url));
const markdownPath = fileURLToPath(new URL("../../docs/grants/evidence/synthetic-baseline.md", import.meta.url));
await mkdir(dirname(jsonPath), { recursive: true });
await Promise.all([
  writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  writeFile(markdownPath, markdown, "utf8"),
]);

console.log(`Grant benchmark: ${report.scenarioCount} synthetic scenarios.`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
