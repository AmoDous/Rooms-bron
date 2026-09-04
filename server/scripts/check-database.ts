import "dotenv/config";
import { Pool } from "pg";
import { postgresPoolConfig } from "../src/storage.js";
import { inspectMigrations, loadMigrations } from "../src/migrations.js";

const json = process.argv.includes("--json");
let pool: Pool | undefined;
try {
  pool = new Pool({ ...postgresPoolConfig(), max: 1, application_name: "rooms-database-check",
    statement_timeout: 10_000, query_timeout: 15_000 });
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    const status = await inspectMigrations(client, await loadMigrations());
    await client.query("commit");
    if (json) console.log(JSON.stringify(status, null, 2));
    else {
      console.log(`Rooms database: ${status.ok ? "READY" : "NOT READY"} (${status.applied.length}/${status.total} recorded updates)`);
      for (const key of ["pending", "changed", "unexpected", "outOfOrder"] as const) {
        if (status[key].length) console.log(`${key}: ${status[key].join(", ")}`);
      }
      console.log("Read-only check: no migrations or booking data were changed.");
    }
    process.exitCode = status.ok ? 0 : 1;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
} catch {
  const error = "Database check failed. Verify connectivity, permissions and migration files. Connection details are omitted.";
  console.error(json ? JSON.stringify({ ok: false, error }) : error);
  process.exitCode = 1;
} finally { await pool?.end(); }
