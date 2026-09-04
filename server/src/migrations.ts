import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SqlExecutor } from "./postgresCatalog.js";

export const migrationNames = [
  "0001_initial", "0002_booking_conversations", "0003_partner_catalog", "0004_auth_security",
  "0005_notification_worker", "0006_partner_photos", "0007_reviews", "0008_support_and_admin_queue",
  "0009_finance_operations", "0010_payout_destination_snapshot", "0011_payment_webhooks_and_receipts",
  "0012_fiscal_receipt_worker", "0013_automatic_refund_worker", "0014_partner_leads", "0015_partner_invitations",
  "0016_partner_invitation_retention", "0017_two_factor_auth", "0018_two_factor_recovery",
  "0019_auth_rate_limits", "0020_room_price_rules",
] as const;

export interface Migration { name: string; sql: string; checksum: string }
export interface MigrationStatus {
  ok: boolean;
  total: number;
  applied: string[];
  pending: string[];
  changed: string[];
  unexpected: string[];
  outOfOrder: string[];
}

export async function loadMigrations(): Promise<Migration[]> {
  const result: Migration[] = [];
  for (const name of migrationNames) {
    // src and compiled dist are both one directory below server.
    const path = name === "0001_initial" ? "../../docs/database.sql" : `../../docs/migrations/${name}.sql`;
    const sql = await readFile(new URL(path, import.meta.url), "utf8");
    result.push({ name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return result;
}

export function compareMigrations(expected: Migration[], applied: { name: string; checksum: string }[]): MigrationStatus {
  const known = new Map(expected.map((item) => [item.name, item]));
  const recorded = new Map(applied.map((item) => [item.name, item.checksum]));
  const pending = expected.filter((item) => !recorded.has(item.name)).map((item) => item.name);
  const changed = expected.filter((item) => recorded.has(item.name) && recorded.get(item.name) !== item.checksum).map((item) => item.name);
  const unexpected = applied.filter((item) => !known.has(item.name)).map((item) => item.name).sort();
  const lastApplied = expected.findLastIndex((item) => recorded.has(item.name));
  const outOfOrder = expected.filter((item, index) => index < lastApplied && !recorded.has(item.name)).map((item) => item.name);
  return {
    ok: !pending.length && !changed.length && !unexpected.length,
    total: expected.length, applied: expected.filter((item) => recorded.has(item.name)).map((item) => item.name),
    pending, changed, unexpected, outOfOrder,
  };
}

export async function inspectMigrations(sql: SqlExecutor, expected: Migration[]): Promise<MigrationStatus> {
  const exists = await sql.query<{ name: string | null }>("select to_regclass('schema_migrations')::text as name");
  const applied = exists.rows[0]?.name
    ? (await sql.query<{ name: string; checksum: string }>("select name, checksum from schema_migrations order by name")).rows
    : [];
  return compareMigrations(expected, applied);
}

function assertCompatibleHistory(status: MigrationStatus): void {
  if (status.changed.length || status.unexpected.length || status.outOfOrder.length) {
    throw new Error(`Database migration history is incompatible. Changed: ${status.changed.join(", ") || "none"}; unknown: ${status.unexpected.join(", ") || "none"}; gaps: ${status.outOfOrder.join(", ") || "none"}. Do not rewrite applied migrations; check the deployed version and restore history before continuing.`);
  }
}

export async function assertDatabaseSchema(sql: SqlExecutor): Promise<void> {
  const status = await inspectMigrations(sql, await loadMigrations());
  assertCompatibleHistory(status);
  if (status.pending.length) {
    throw new Error(`Database updates are required: ${status.pending.join(", ")}. Back up the database and run npm run db:migrate before starting Rooms.`);
  }
}

export async function applyMigrations(client: SqlExecutor, migrations: Migration[], onApplied: (name: string) => void = () => undefined): Promise<string[]> {
  // Session lock: the caller must keep this dedicated connection until completion.
  const locked = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(1919905651, 1) as locked");
  if (!locked.rows[0]?.locked) throw new Error("Another Rooms migration is running. Wait for it to finish and retry.");
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum char(64) not null, applied_at timestamptz not null default now()
    )`);
    const status = await inspectMigrations(client, migrations);
    assertCompatibleHistory(status);
    const completed: string[] = [];
    for (const migration of migrations.filter((item) => status.pending.includes(item.name))) {
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into schema_migrations(name, checksum) values ($1, $2)", [migration.name, migration.checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
      completed.push(migration.name);
      onApplied(migration.name);
    }
    return completed;
  } finally {
    await client.query("select pg_advisory_unlock(1919905651, 1)");
  }
}
