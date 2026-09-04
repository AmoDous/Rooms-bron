import { resolve, sep } from "node:path";

const backupPattern = /^rooms-(\d{8}T\d{6}Z)\.backup$/;

export interface BackupDatabaseTarget {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

export function backupFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `rooms-${stamp}.backup`;
}

export function backupCreatedAt(filename: string): Date | null {
  const match = filename.match(backupPattern);
  if (!match?.[1]) return null;
  const value = match[1];
  const parsed = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function backupsToPrune(filenames: string[], now: Date, retentionDays: number): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return filenames.filter((filename) => {
    const createdAt = backupCreatedAt(filename);
    return createdAt !== null && createdAt.getTime() < cutoff;
  });
}

export function parseDatabaseTarget(databaseUrl: string): BackupDatabaseTarget {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!parsed.hostname || !database || !parsed.username) throw new Error("DATABASE_URL must include host, database and username.");
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

export function assertPathInside(directory: string, candidate: string): void {
  const root = `${resolve(directory).toLowerCase()}${sep}`;
  const target = resolve(candidate).toLowerCase();
  if (!target.startsWith(root)) throw new Error("Backup cleanup refused a path outside BACKUP_DIR.");
}
