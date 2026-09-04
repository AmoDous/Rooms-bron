import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildPilotBenchmarkReport, pilotBenchmarkMarkdown } from "../src/pilotBenchmark.js";
import { importPilotDataset, PilotDatasetValidationError } from "../src/pilotDataset.js";

const { values } = parseArgs({
  options: {
    rooms: { type: "string" },
    blocks: { type: "string" },
    requests: { type: "string" },
    output: { type: "string" },
    force: { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.rooms || !values.blocks || !values.requests) throw new Error("Укажите --rooms, --blocks и --requests.");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

try {
  const [rooms, blocks, requests] = await Promise.all([
    readFile(resolve(values.rooms), "utf8"),
    readFile(resolve(values.blocks), "utf8"),
    readFile(resolve(values.requests), "utf8"),
  ]);
  const dataset = importPilotDataset({ rooms, blocks, requests });
  const report = buildPilotBenchmarkReport(dataset);
  console.log(`Пилотная базовая линия: ${report.scenarioCount} запросов, ${report.capacityEligibleScenarios} прошли ограничение вместимости.`);
  console.log(`Совпадение реконструкции доступности: ${report.reconstructedAvailabilityMatches}/${report.knownRecordedAvailability}.`);
  console.log(`SHA-256 набора: ${report.datasetHash}`);
  if (values.output) {
    const prefix = resolve(values.output);
    const jsonPath = `${prefix}.json`;
    const markdownPath = `${prefix}.md`;
    if (!values.force && ((await exists(jsonPath)) || (await exists(markdownPath)))) {
      throw new Error(`Результат ${prefix} уже существует. Добавьте --force только после проверки.`);
    }
    await mkdir(dirname(prefix), { recursive: true });
    const generatedAt = new Date().toISOString();
    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify({ generatedAt, report }, null, 2)}\n`, "utf8"),
      writeFile(markdownPath, pilotBenchmarkMarkdown(report, generatedAt), "utf8"),
    ]);
    console.log(`JSON: ${jsonPath}`);
    console.log(`Отчёт: ${markdownPath}`);
  } else {
    console.log("Файлы не записаны: это был режим проверки.");
  }
} catch (error) {
  if (error instanceof PilotDatasetValidationError) {
    for (const issue of error.issues) console.error(`${issue.file}:${issue.row}${issue.column ? `:${issue.column}` : ""} — ${issue.message}`);
  }
  throw error;
}
