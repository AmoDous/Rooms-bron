import "dotenv/config";
import { Pool } from "pg";
import { postgresPoolConfig } from "../src/storage.js";
import { applyMigrations, loadMigrations } from "../src/migrations.js";

const migrations = await loadMigrations();
const pool = new Pool({ ...postgresPoolConfig(), max: 1, application_name: "rooms-migrate" });

try {
  const client = await pool.connect();
  try {
    const applied = await applyMigrations(client, migrations, (name) => console.log(`Applied migration ${name}.`));
    if (!applied.length) console.log("All Rooms database migrations are already applied.");
  } finally { client.release(); }
} finally { await pool.end(); }
