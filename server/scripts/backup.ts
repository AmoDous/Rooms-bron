import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { assertPathInside, backupFilename, backupsToPrune, parseDatabaseTarget } from "../src/backups.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to create a Rooms backup.");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
  throw new Error("BACKUP_RETENTION_DAYS must be an integer between 1 and 3650.");
}

const backupDir = resolve(process.env.BACKUP_DIR?.trim() || "server-data/backups");
const now = new Date();
const filename = backupFilename(now);
const finalPath = join(backupDir, filename);
const partialPath = `${finalPath}.partial`;
const metadataPath = `${finalPath}.json`;
const latestPath = join(backupDir, "latest.json");
const latestPartialPath = `${latestPath}.partial`;
const target = parseDatabaseTarget(databaseUrl);

async function postgresTool(name: "pg_dump" | "pg_restore", explicitPath: string | undefined): Promise<string> {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    explicitPath?.trim(),
    process.env.POSTGRES_BIN?.trim() ? join(process.env.POSTGRES_BIN.trim(), executable) : "",
    ...(process.platform === "win32" ? [18, 17, 16, 15].map((version) => `C:\\Program Files\\PostgreSQL\\${version}\\bin\\${executable}`) : []),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next configured installation. */ }
  }
  return executable;
}

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, env: extraEnv });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${basename(command)} exited with code ${code ?? "unknown"}.`)));
  });
}

function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.once("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("end", () => resolveHash(hash.digest("hex")));
  });
}

await mkdir(backupDir, { recursive: true });
await rm(partialPath, { force: true });
const pgDump = await postgresTool("pg_dump", process.env.PG_DUMP_PATH);
const childEnv = {
  ...process.env,
  PGPASSWORD: target.password,
  PGSSLMODE: process.env.DATABASE_SSL?.trim() || "prefer",
};

try {
  await run(pgDump, [
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-acl",
    "--host", target.host,
    "--port", target.port,
    "--username", target.username,
    "--dbname", target.database,
    "--file", partialPath,
  ], childEnv);
  await rename(partialPath, finalPath);
  const fileStat = await stat(finalPath);
  const checksum = await sha256(finalPath);
  const metadata = {
    format: "rooms-postgresql-backup",
    version: 1,
    filename,
    createdAt: now.toISOString(),
    sizeBytes: fileStat.size,
    sha256: checksum,
    database: { host: target.host, port: target.port, name: target.database },
  };
  const metadataJson = `${JSON.stringify(metadata, null, 2)}\n`;
  await writeFile(metadataPath, metadataJson, { encoding: "utf8", flag: "wx" });
  await writeFile(latestPartialPath, metadataJson, { encoding: "utf8" });
  await rename(latestPartialPath, latestPath);

  const files = await readdir(backupDir);
  for (const expired of backupsToPrune(files, now, retentionDays)) {
    const expiredPath = join(backupDir, expired);
    assertPathInside(backupDir, expiredPath);
    await rm(expiredPath, { force: true });
    await rm(`${expiredPath}.json`, { force: true });
  }
  console.log(`Rooms backup created: ${finalPath}`);
  console.log(`Size: ${fileStat.size} bytes; SHA-256: ${checksum}`);
} catch (error) {
  await rm(partialPath, { force: true }).catch(() => undefined);
  await rm(latestPartialPath, { force: true }).catch(() => undefined);
  throw error;
}
