import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  buildPlanningOracleReport,
  comparePlannerWithOracle,
  planningOracleScenarios,
} from "../src/planningOracle.js";

const scenarios = planningOracleScenarios();
const started = performance.now();
const comparisons = scenarios.map((scenario) => comparePlannerWithOracle(scenario.request));
const elapsedMilliseconds = performance.now() - started;
const report = buildPlanningOracleReport(scenarios);
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  dataNotice: "Synthetic exhaustive-oracle check only. This is not pilot or customer data.",
  elapsedMilliseconds: Math.round(elapsedMilliseconds * 1000) / 1000,
  meanMillisecondsPerScenario: Math.round((elapsedMilliseconds / scenarios.length) * 1000) / 1000,
  report,
};

const markdown = `# Проверка полноты планировщика Rooms

Дата формирования: ${artifact.generatedAt}

> Проверка выполнена только на синтетических малых задачах. Она подтверждает совпадение с независимым полным перебором в границах набора, но не доказывает эффективность на реальных площадках.

## Набор

- версия эталона: ${report.oracleVersion};
- seed генератора: ${report.seed};
- сценариев: ${report.scenarioCount};
- SHA-256 набора: \`${report.datasetHash}\`;
- вариантов планировщика: ${report.plannerCandidateCount};
- вариантов полного перебора: ${report.oracleCandidateCount}.

Сценарии включают от одного до трёх наборов, от одного до трёх одновременно требуемых помещений, шаги 15/30/60 минут, разные буферы, рабочие часы с переходом через полночь, занятость, предел цены, вместимость и минимальную длительность.

## Результат

- полное совпадение: ${report.completeScenarios} из ${report.scenarioCount};
- сценариев с расхождением: ${report.failedScenarios};
- пропущено допустимых вариантов: ${report.missingCandidateCount};
- возвращено недопустимых вариантов: ${report.unexpectedCandidateCount};
- время всей проверки: ${artifact.elapsedMilliseconds} мс;
- среднее время на сценарий: ${artifact.meanMillisecondsPerScenario} мс.

## Ограничения

Эталон использует дискретный перебор с минимальным шагом 15 минут и предназначен для малых задач. Он не заменяет доказательство корректности, генеративное тестирование на более широких границах, нагрузочное испытание и пилот. При любом расхождении отчёт считается неуспешным, а список ключей вариантов сохраняется в JSON.
`;

const jsonPath = fileURLToPath(new URL("../../docs/grants/evidence/oracle-completeness.json", import.meta.url));
const markdownPath = fileURLToPath(new URL("../../docs/grants/evidence/oracle-completeness.md", import.meta.url));
await mkdir(dirname(jsonPath), { recursive: true });
await Promise.all([
  writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  writeFile(markdownPath, markdown, "utf8"),
]);

if (comparisons.some((comparison) => !comparison.complete)) process.exitCode = 1;
console.log(`Planning oracle: ${report.completeScenarios}/${report.scenarioCount} complete scenarios.`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
