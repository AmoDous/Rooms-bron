import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { test } from "node:test";
import type { QueryResultRow } from "pg";
import { applyMigrations, assertDatabaseSchema, compareMigrations, inspectMigrations, loadMigrations, migrationNames, type Migration } from "../src/migrations.js";
import type { SqlExecutor } from "../src/postgresCatalog.js";

const fixtures: Migration[] = [1, 2, 3].map((number) => ({ name: `000${number}_test`, sql: `SQL ${number}`, checksum: String(number).repeat(64) }));

class FakeSql implements SqlExecutor {
  calls: string[] = [];
  rows: { name: string; checksum: string }[] = [];
  tableExists = true;
  lockAvailable = true;
  failSql = "";
  snapshot: { name: string; checksum: string }[] = [];
  async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }> {
    this.calls.push(text);
    if (text === this.failSql) throw new Error("test migration failed");
    let rows: unknown[] = [];
    if (text.includes("pg_try_advisory_lock")) rows = [{ locked: this.lockAvailable }];
    else if (text.includes("to_regclass")) rows = [{ name: this.tableExists ? "schema_migrations" : null }];
    else if (text.startsWith("create table")) this.tableExists = true;
    else if (text.startsWith("select name, checksum")) rows = this.rows;
    else if (text === "begin") this.snapshot = [...this.rows];
    else if (text === "rollback") this.rows = this.snapshot;
    else if (text.startsWith("insert into schema_migrations")) this.rows.push({ name: String(values?.[0]), checksum: String(values?.[1]) });
    return { rows: rows as Row[] };
  }
}

test("shared migration manifest includes every SQL update and preserves raw checksums", async () => {
  const files = (await readdir(new URL("../../docs/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files, migrationNames.slice(1).map((name) => `${name}.sql`));
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 20);
  assert.equal(new Set(migrations.map((item) => item.name)).size, migrations.length);
  for (const item of migrations) {
    assert.match(item.checksum, /^[a-f0-9]{64}$/);
    assert.ok(item.sql.length > 0);
  }
});

test("schema inspection is read-only and reports all updates on an empty database", async () => {
  const sql = new FakeSql();
  sql.tableExists = false;
  const status = await inspectMigrations(sql, fixtures);
  assert.equal(status.ok, false);
  assert.deepEqual(status.pending, fixtures.map((item) => item.name));
  assert.ok(sql.calls.every((text) => text.startsWith("select ")));
});

test("schema comparison distinguishes pending, changed, unknown and missing historical updates", () => {
  assert.equal(compareMigrations(fixtures, fixtures).ok, true);
  assert.deepEqual(compareMigrations(fixtures, fixtures.slice(0, 1)).pending, fixtures.slice(1).map((item) => item.name));
  assert.deepEqual(compareMigrations(fixtures, [{ ...fixtures[0]!, checksum: "changed" }]).changed, [fixtures[0]!.name]);
  assert.deepEqual(compareMigrations(fixtures, [{ name: "9999_future", checksum: "future" }]).unexpected, ["9999_future"]);
  assert.deepEqual(compareMigrations(fixtures, fixtures.slice(1)).outOfOrder, [fixtures[0]!.name]);
});

test("migrator applies only pending updates transactionally and is repeatable", async () => {
  const sql = new FakeSql();
  sql.rows = [fixtures[0]!];
  const logged: string[] = [];
  assert.deepEqual(await applyMigrations(sql, fixtures, (name) => logged.push(name)), fixtures.slice(1).map((item) => item.name));
  assert.deepEqual(logged, fixtures.slice(1).map((item) => item.name));
  assert.equal(sql.calls.filter((text) => text === "commit").length, 2);
  assert.ok(!sql.calls.includes("SQL 1"));
  assert.ok(sql.calls.at(-1)?.includes("pg_advisory_unlock"));
  sql.calls = [];
  assert.deepEqual(await applyMigrations(sql, fixtures), []);
  assert.ok(!sql.calls.includes("begin"));
});

test("migrator refuses a concurrent runner before touching the schema", async () => {
  const sql = new FakeSql();
  sql.lockAvailable = false;
  await assert.rejects(applyMigrations(sql, fixtures), /Another Rooms migration/);
  assert.equal(sql.calls.length, 1);
});

test("migrator checks the entire existing history before applying any pending SQL", async () => {
  for (const rows of [ [{ ...fixtures[0]!, checksum: "changed" }], fixtures.slice(1), [{ name: "9999_future", checksum: "future" }] ]) {
    const sql = new FakeSql();
    sql.rows = rows;
    await assert.rejects(applyMigrations(sql, fixtures), /history is incompatible/);
    assert.ok(!sql.calls.includes("begin"));
    assert.ok(sql.calls.at(-1)?.includes("pg_advisory_unlock"));
  }
});

test("failed update rolls back, retains previously committed updates and releases the lock", async () => {
  const sql = new FakeSql();
  sql.failSql = "SQL 2";
  await assert.rejects(applyMigrations(sql, fixtures), /test migration failed/);
  assert.deepEqual(sql.rows.map((item) => item.name), [fixtures[0]!.name]);
  assert.ok(sql.calls.includes("rollback"));
  assert.ok(!sql.calls.includes("SQL 3"));
  assert.ok(sql.calls.at(-1)?.includes("pg_advisory_unlock"));
});

test("startup schema check accepts the current database without writes", async () => {
  const sql = new FakeSql();
  sql.rows = await loadMigrations();
  await assert.doesNotReject(assertDatabaseSchema(sql));
  assert.ok(sql.calls.every((text) => text.startsWith("select ")));
});

test("startup schema check rejects an outdated database with an actionable error", async () => {
  const sql = new FakeSql();
  sql.rows = (await loadMigrations()).slice(0, -1);
  await assert.rejects(assertDatabaseSchema(sql), /0020_room_price_rules.*npm run db:migrate/);
  sql.rows.push({ name: "9999_future", checksum: "future" });
  await assert.rejects(assertDatabaseSchema(sql), /history is incompatible/);
});
