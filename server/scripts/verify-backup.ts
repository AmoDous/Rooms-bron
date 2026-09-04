import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { backupCreatedAt } from "../src/backups.js";

const backupDir = resolve(process.env.BACKUP_DIR?.trim() || "server-data/backups");

async function postgresRestoreTool(): Promise<string> {
  const executable = process.platform === "win32" ? "pg_restore.exe" : "pg_restore";
  const candidates = [
    process.env.PG_RESTORE_PATH?.trim(),
    process.env.POSTGRES_BIN?.trim() ? join(process.env.POSTGRES_BIN.trim(), executable) : "",
    ...(process.platform === "win32" ? [18, 17, 16, 15].map((version) => `C:\\Program Files\\PostgreSQL\\${version}\\bin\\${executable}`) : []),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next configured installation. */ }
  }
  return executable;
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

function inspectArchive(command: string, path: string): Promise<string> {
  return new Promise((resolveInspect, reject) => {
    const child = spawn(command, ["--list", path], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveInspect(stdout) : reject(new Error(`${basename(command)} could not read the archive: ${stderr.trim() || `exit ${code}`}`)));
  });
}

const requested = process.env.BACKUP_FILE?.trim();
const available = (await readdir(backupDir))
  .filter((filename) => backupCreatedAt(filename))
  .sort((left, right) => right.localeCompare(left));
const backupPath = requested ? resolve(requested) : available[0] ? join(backupDir, available[0]) : "";
if (!backupPath) throw new Error(`No Rooms backups found in ${backupDir}.`);
const metadata = JSON.parse(await readFile(`${backupPath}.json`, "utf8")) as { format?: string; filename?: string; sizeBytes?: number; sha256?: string };
if (metadata.format !== "rooms-postgresql-backup" || metadata.filename !== basename(backupPath)) {
  throw new Error("Backup metadata is missing or does not belong to this archive.");
}
const fileStat = await stat(backupPath);
if (fileStat.size !== metadata.sizeBytes) throw new Error("Backup size differs from its metadata.");
const checksum = await sha256(backupPath);
if (checksum !== metadata.sha256) throw new Error("Backup SHA-256 checksum verification failed.");
const archiveList = await inspectArchive(await postgresRestoreTool(), backupPath);
for (const requiredObject of ["schema_migrations", "users", "venues", "rooms", "bookings"]) {
  if (!archiveList.includes(requiredObject)) throw new Error(`Backup archive does not contain required object: ${requiredObject}.`);
}
console.log(`Rooms backup verified: ${backupPath}`);
console.log(`Size: ${fileStat.size} bytes; SHA-256: ${checksum}`);
