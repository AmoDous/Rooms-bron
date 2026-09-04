import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  AuthRateLimiter,
  PostgresRateLimitRepository,
} from "../src/rateLimits.js";
import { postgresPoolConfig } from "../src/storage.js";

const pool = new Pool({
  ...postgresPoolConfig(),
  max: 8,
  application_name: "rooms-rate-limit-smoke",
});
const scope = `smoke_rate_limit_${Date.now()}`;
const rawKey = "203.0.113.199";
const repository = new PostgresRateLimitRepository(pool);
const limiter = new AuthRateLimiter(
  repository,
  scope,
  randomBytes(32).toString("hex"),
  50,
  60_000,
);

try {
  await Promise.all(Array.from({ length: 50 }, () => limiter.fail(rawKey)));
  assert.equal(await limiter.blocked(rawKey), true);

  const stored = await pool.query<{ key_hash: string; failures: number }>(
    "select key_hash, failures from auth_rate_limits where scope = $1",
    [scope],
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(Number(stored.rows[0]?.failures), 50);
  assert.match(stored.rows[0]?.key_hash ?? "", /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(stored.rows[0]?.key_hash ?? "", /203\.0\.113\.199/u);

  await limiter.clear(rawKey);
  const remaining = await pool.query<{ count: string }>(
    "select count(*)::text as count from auth_rate_limits where scope = $1",
    [scope],
  );
  assert.equal(remaining.rows[0]?.count, "0");
  console.log("PostgreSQL rate-limit concurrency smoke test passed.");
} finally {
  await pool.query("delete from auth_rate_limits where scope = $1", [scope]).catch(() => undefined);
  await pool.end();
}
