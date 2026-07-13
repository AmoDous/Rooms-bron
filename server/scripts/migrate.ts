import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresPoolConfig } from "../src/storage.js";

const migrationName = "0001_initial";
const schemaPath = fileURLToPath(new URL("../../docs/database.sql", import.meta.url));
const schema = await readFile(schemaPath, "utf8");
const checksum = createHash("sha256").update(schema).digest("hex");
const pool = new Pool({ ...postgresPoolConfig(), max: 1, application_name: "rooms-migrate" });
const client = await pool.connect();

try {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum char(64) not null,
      applied_at timestamptz not null default now()
    )
  `);
  const existing = await client.query<{ checksum: string }>("select checksum from schema_migrations where name = $1", [migrationName]);
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== checksum) {
      throw new Error(`Migration ${migrationName} was already applied with a different checksum.`);
    }
    console.log(`Migration ${migrationName} is already applied.`);
  } else {
    await client.query("begin");
    await client.query(schema);
    await client.query("insert into schema_migrations(name, checksum) values ($1, $2)", [migrationName, checksum]);
    await client.query("commit");
    console.log(`Applied migration ${migrationName}.`);
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
