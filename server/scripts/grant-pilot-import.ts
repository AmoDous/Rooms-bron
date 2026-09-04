import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  importPilotDataset,
  pilotDatasetMarkdown,
  PilotDatasetValidationError,
} from "../src/pilotDataset.js";

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

if (!values.rooms || !values.blocks || !values.requests) {
  throw new Error("Укажите --rooms, --blocks и --requests. Путь --output необязателен.");
}

const paths = {
  rooms: resolve(values.rooms),
  blocks: resolve(values.blocks),
  requests: resolve(values.requests),
};

try {
  const [rooms, blocks, requests] = await Promise.all([
    readFile(paths.rooms, "utf8"),
    readFile(paths.blocks, "utf8"),
    readFile(paths.requests, "utf8"),
  ]);
  const dataset = importPilotDataset({ rooms, blocks, requests });
  console.log(`Проверка пройдена: ${dataset.summary.venueCount} площадок, ${dataset.summary.roomCount} помещений, ${dataset.summary.blockCount} блоков, ${dataset.summary.requestCount} запросов.`);
  console.log(`SHA-256: ${dataset.datasetHash}`);
  if (values.output) {
    const prefix = resolve(values.output);
    const jsonPath = `${prefix}.json`;
    const markdownPath = `${prefix}.md`;
    if (!values.force) {
      for (const path of [jsonPath, markdownPath]) {
        try {
          await access(path, constants.F_OK);
          throw new Error(`Файл уже существует: ${path}. Добавьте --force только после проверки.`);
        } catch (error) {
          if (error instanceof Error && !error.message.startsWith("ENOENT") && !("code" in error && error.code === "ENOENT")) throw error;
        }
      }
    }
    await mkdir(dirname(prefix), { recursive: true });
    const generatedAt = new Date().toISOString();
    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify({ generatedAt, ...dataset }, null, 2)}\n`, "utf8"),
      writeFile(markdownPath, pilotDatasetMarkdown(dataset, generatedAt), "utf8"),
    ]);
    console.log(`JSON: ${jsonPath}`);
    console.log(`Отчёт: ${markdownPath}`);
  } else {
    console.log("Файлы не записаны: это был режим проверки.");
  }
} catch (error) {
  if (error instanceof PilotDatasetValidationError) {
    for (const issue of error.issues) {
      console.error(`${issue.file}:${issue.row}${issue.column ? `:${issue.column}` : ""} — ${issue.message}`);
    }
  }
  throw error;
}
