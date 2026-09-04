import { createHmac } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";

export interface RateLimitState {
  failures: number;
  expiresAt: string;
}

export interface RateLimitRepository {
  readonly storage: "memory" | "postgresql";
  get(scope: string, keyHash: string, checkedAt: string): Promise<RateLimitState | null>;
  recordFailure(scope: string, keyHash: string, windowMs: number, failedAt: string): Promise<RateLimitState>;
  clear(scope: string, keyHash: string): Promise<void>;
}

interface MemoryRateLimitEntry extends RateLimitState {
  updatedAt: string;
}

export class MemoryRateLimitRepository implements RateLimitRepository {
  readonly storage = "memory" as const;
  private readonly entries = new Map<string, MemoryRateLimitEntry>();

  constructor(private readonly maxEntries = 20_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Rate-limit repository capacity must be a positive integer.");
    }
  }

  async get(scope: string, keyHash: string, checkedAt: string): Promise<RateLimitState | null> {
    const storageKey = this.storageKey(scope, keyHash);
    const entry = this.entries.get(storageKey);
    if (!entry || new Date(entry.expiresAt).getTime() <= new Date(checkedAt).getTime()) {
      this.entries.delete(storageKey);
      return null;
    }
    return { failures: entry.failures, expiresAt: entry.expiresAt };
  }

  async recordFailure(
    scope: string,
    keyHash: string,
    windowMs: number,
    failedAt: string,
  ): Promise<RateLimitState> {
    const storageKey = this.storageKey(scope, keyHash);
    const failedAtMs = new Date(failedAt).getTime();
    const current = this.entries.get(storageKey);
    const next: MemoryRateLimitEntry = current && new Date(current.expiresAt).getTime() > failedAtMs
      ? { ...current, failures: Math.min(current.failures + 1, 100_000), updatedAt: failedAt }
      : {
          failures: 1,
          expiresAt: new Date(failedAtMs + windowMs).toISOString(),
          updatedAt: failedAt,
        };
    if (!current && this.entries.size >= this.maxEntries) this.prune(failedAtMs);
    this.entries.set(storageKey, next);
    return { failures: next.failures, expiresAt: next.expiresAt };
  }

  async clear(scope: string, keyHash: string): Promise<void> {
    this.entries.delete(this.storageKey(scope, keyHash));
  }

  private storageKey(scope: string, keyHash: string): string {
    return `${scope}|${keyHash}`;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (new Date(entry.expiresAt).getTime() <= now) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}

interface RateLimitRow extends QueryResultRow {
  failures: number;
  expires_at: Date | string;
}

function stateFromRow(row: RateLimitRow): RateLimitState {
  return {
    failures: Number(row.failures),
    expiresAt: row.expires_at instanceof Date
      ? row.expires_at.toISOString()
      : new Date(row.expires_at).toISOString(),
  };
}

export class PostgresRateLimitRepository implements RateLimitRepository {
  readonly storage = "postgresql" as const;
  private failureWrites = 0;

  constructor(private readonly pool: Pool) {}

  async get(scope: string, keyHash: string, checkedAt: string): Promise<RateLimitState | null> {
    const result = await this.pool.query<RateLimitRow>(`/* rooms:get-auth-rate-limit */
      select failures, expires_at
      from auth_rate_limits
      where scope = $1 and key_hash = $2 and expires_at > $3::timestamptz
    `, [scope, keyHash, checkedAt]);
    return result.rows[0] ? stateFromRow(result.rows[0]) : null;
  }

  async recordFailure(
    scope: string,
    keyHash: string,
    windowMs: number,
    failedAt: string,
  ): Promise<RateLimitState> {
    const expiresAt = new Date(new Date(failedAt).getTime() + windowMs).toISOString();
    const result = await this.pool.query<RateLimitRow>(`/* rooms:record-auth-rate-limit */
      insert into auth_rate_limits (
        scope, key_hash, failures, expires_at, updated_at
      ) values (
        $1, $2, 1, $3::timestamptz, $4::timestamptz
      )
      on conflict (scope, key_hash) do update
      set failures = case
            when auth_rate_limits.expires_at <= excluded.updated_at then 1
            else least(auth_rate_limits.failures + 1, 100000)
          end,
          expires_at = case
            when auth_rate_limits.expires_at <= excluded.updated_at then excluded.expires_at
            else auth_rate_limits.expires_at
          end,
          updated_at = greatest(auth_rate_limits.updated_at, excluded.updated_at)
      returning failures, expires_at
    `, [scope, keyHash, expiresAt, failedAt]);
    this.failureWrites += 1;
    if (this.failureWrites % 1_000 === 0) {
      await this.pool.query("delete from auth_rate_limits where expires_at < now() - interval '1 day'")
        .catch(() => undefined);
    }
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the updated authentication rate limit.");
    return stateFromRow(row);
  }

  async clear(scope: string, keyHash: string): Promise<void> {
    await this.pool.query(
      "delete from auth_rate_limits where scope = $1 and key_hash = $2",
      [scope, keyHash],
    );
  }
}

export class AuthRateLimiter {
  constructor(
    private readonly repository: RateLimitRepository,
    private readonly scope: string,
    private readonly hashKey: string,
    private readonly maxFailures = 5,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!/^[a-z0-9_.:-]{1,80}$/u.test(scope)) {
      throw new Error("Rate-limit scope must contain only lowercase ASCII letters, digits and ._:-.");
    }
    if (!hashKey) throw new Error("Rate-limit HMAC key is required.");
    if (!Number.isInteger(maxFailures) || maxFailures < 1) {
      throw new Error("Rate-limit failure threshold must be a positive integer.");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error("Rate-limit window must be a positive integer.");
    }
  }

  async blocked(key: string): Promise<boolean> {
    const state = await this.repository.get(this.scope, this.keyHash(key), this.now().toISOString());
    return state !== null && state.failures >= this.maxFailures;
  }

  async fail(key: string): Promise<number> {
    const state = await this.repository.recordFailure(
      this.scope,
      this.keyHash(key),
      this.windowMs,
      this.now().toISOString(),
    );
    return state.failures;
  }

  async clear(key: string): Promise<void> {
    await this.repository.clear(this.scope, this.keyHash(key));
  }

  private keyHash(key: string): string {
    return createHmac("sha256", this.hashKey)
      .update(this.scope)
      .update("\0")
      .update(key)
      .digest("hex");
  }
}
