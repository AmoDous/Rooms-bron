import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { assertPathInside, backupCreatedAt, backupFilename, backupsToPrune, parseDatabaseTarget } from "../src/backups.js";

test("backup names are stable UTC timestamps", () => {
  assert.equal(backupFilename(new Date("2026-09-02T15:04:05.678Z")), "rooms-20260902T150405Z.backup");
  assert.equal(backupCreatedAt("rooms-20260902T150405Z.backup")?.toISOString(), "2026-09-02T15:04:05.000Z");
  assert.equal(backupCreatedAt("customer-data.backup"), null);
});

test("backup retention only selects managed expired archives", () => {
  assert.deepEqual(backupsToPrune([
    "rooms-20260801T000000Z.backup",
    "rooms-20260825T000000Z.backup",
    "foreign.backup",
    "rooms-20260801T000000Z.backup.json",
  ], new Date("2026-09-02T00:00:00Z"), 14), ["rooms-20260801T000000Z.backup"]);
});

test("database URL parsing keeps credentials out of command arguments", () => {
  assert.deepEqual(parseDatabaseTarget("postgresql://rooms%20user:s%40fe@db.example:5433/rooms%20pilot"), {
    host: "db.example",
    port: "5433",
    database: "rooms pilot",
    username: "rooms user",
    password: "s@fe",
  });
  assert.throws(() => parseDatabaseTarget("https://db.example/rooms"), /PostgreSQL protocol/);
});

test("cleanup refuses paths outside the configured backup directory", () => {
  const directory = resolve("server-data/backups");
  assert.doesNotThrow(() => assertPathInside(directory, join(directory, "rooms-20260902T150405Z.backup")));
  assert.throws(() => assertPathInside(directory, resolve("server-data/production.env")), /outside BACKUP_DIR/);
});
