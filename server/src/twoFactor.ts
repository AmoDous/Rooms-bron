import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import qrcode from "qrcode-generator";
import type { Pool, QueryResultRow } from "pg";
import type { AuthUser, UserRole } from "./auth.js";

export const twoFactorChallengeLifetimeSeconds = 5 * 60;
export const twoFactorRecoveryLifetimeSeconds = 24 * 60 * 60;
const maxChallengeAttempts = 5;
const recoveryCodeCount = 8;

export type TwoFactorChallengeMode = "setup" | "verify";
export type TwoFactorRecoveryStatus = "pending" | "approved" | "rejected" | "expired";
export type TwoFactorRecoveryQueryStatus = TwoFactorRecoveryStatus | "all";
export type TwoFactorRecoveryDecision = "approved" | "rejected";

export interface TwoFactorRecord {
  userId: string;
  secretCiphertext: string;
  recoveryCodeHashes: string[];
  lastUsedCounter: number | null;
  enabledAt: string;
  updatedAt: string;
}

export interface TwoFactorChallengeRecord {
  id: string;
  userId: string;
  tokenHash: string;
  mode: TwoFactorChallengeMode;
  pendingSecretCiphertext: string | null;
  attempts: number;
  expiresAt: string;
  consumedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface TwoFactorSetupRecord {
  userId: string;
  secretCiphertext: string;
  recoveryCodeHashes: string[];
  lastUsedCounter: number;
  enabledAt: string;
}

export interface TwoFactorRecoveryRecord {
  id: string;
  userId: string;
  status: TwoFactorRecoveryStatus;
  requestIp: string | null;
  requestUserAgent: string | null;
  expiresAt: string;
  reviewedBy: string | null;
  reviewComment: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TwoFactorRecoveryRequestInput {
  id: string;
  requestIp: string | null;
  requestUserAgent: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface TwoFactorRecoveryDecisionResult {
  record: TwoFactorRecoveryRecord;
  factorReset: boolean;
}

export interface TwoFactorRepository {
  readonly storage: "memory" | "postgresql";
  getFactor(userId: string): Promise<TwoFactorRecord | null>;
  createChallenge(input: TwoFactorChallengeRecord): Promise<void>;
  getChallenge(tokenHash: string): Promise<TwoFactorChallengeRecord | null>;
  failChallenge(tokenHash: string, failedAt: string): Promise<number | null>;
  completeSetup(tokenHash: string, factor: TwoFactorSetupRecord, completedAt: string): Promise<string | null>;
  completeTotp(tokenHash: string, counter: number, completedAt: string): Promise<string | null>;
  completeRecovery(tokenHash: string, recoveryCodeHash: string, completedAt: string): Promise<string | null>;
  createRecoveryRequest(tokenHash: string, input: TwoFactorRecoveryRequestInput): Promise<TwoFactorRecoveryRecord | null>;
  getRecoveryRequest(requestId: string, listedAt: string): Promise<TwoFactorRecoveryRecord | null>;
  listRecoveryRequests(status: TwoFactorRecoveryQueryStatus, limit: number, listedAt: string): Promise<TwoFactorRecoveryRecord[]>;
  decideRecoveryRequest(
    requestId: string,
    actorId: string,
    decision: TwoFactorRecoveryDecision,
    comment: string,
    decidedAt: string,
  ): Promise<TwoFactorRecoveryDecisionResult | null>;
}

export interface TwoFactorSetupPayload {
  secret: string;
  otpAuthUrl: string;
  qrDataUrl: string;
}

export interface TwoFactorChallengePayload {
  twoFactorRequired: true;
  setupRequired: boolean;
  challengeToken: string;
  expiresIn: number;
  setup?: TwoFactorSetupPayload;
}

export interface TwoFactorCompletion {
  userId: string;
  recoveryCodes: string[] | null;
  usedRecoveryCode: boolean;
}

export interface TwoFactorStatus {
  required: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

export class TwoFactorError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code:
      | "TWO_FACTOR_CHALLENGE_UNAVAILABLE"
      | "TWO_FACTOR_CODE_INVALID"
      | "TWO_FACTOR_ALREADY_ENABLED"
      | "TWO_FACTOR_RECOVERY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

function available(challenge: TwoFactorChallengeRecord, now: number): boolean {
  return challenge.consumedAt === null
    && challenge.attempts < maxChallengeAttempts
    && new Date(challenge.expiresAt).getTime() > now;
}

function cloneFactor(record: TwoFactorRecord): TwoFactorRecord {
  return structuredClone(record);
}

function cloneChallenge(record: TwoFactorChallengeRecord): TwoFactorChallengeRecord {
  return structuredClone(record);
}

function cloneRecovery(record: TwoFactorRecoveryRecord): TwoFactorRecoveryRecord {
  return structuredClone(record);
}

export class MemoryTwoFactorRepository implements TwoFactorRepository {
  readonly storage = "memory" as const;
  private readonly factors = new Map<string, TwoFactorRecord>();
  private readonly challenges = new Map<string, TwoFactorChallengeRecord>();
  private readonly recoveries = new Map<string, TwoFactorRecoveryRecord>();

  async getFactor(userId: string): Promise<TwoFactorRecord | null> {
    const factor = this.factors.get(userId);
    return factor ? cloneFactor(factor) : null;
  }

  async createChallenge(input: TwoFactorChallengeRecord): Promise<void> {
    for (const [hash, challenge] of this.challenges) {
      if (challenge.userId === input.userId && challenge.consumedAt === null) {
        this.challenges.set(hash, { ...challenge, consumedAt: input.createdAt });
      }
      if (new Date(challenge.expiresAt).getTime() < Date.now() - 7 * 86_400_000) this.challenges.delete(hash);
    }
    this.challenges.set(input.tokenHash, cloneChallenge(input));
  }

  async getChallenge(tokenHash: string): Promise<TwoFactorChallengeRecord | null> {
    const challenge = this.challenges.get(tokenHash);
    return challenge ? cloneChallenge(challenge) : null;
  }

  async failChallenge(tokenHash: string, failedAt: string): Promise<number | null> {
    const challenge = this.challenges.get(tokenHash);
    if (!challenge || !available(challenge, new Date(failedAt).getTime())) return null;
    const attempts = challenge.attempts + 1;
    this.challenges.set(tokenHash, {
      ...challenge,
      attempts,
      consumedAt: attempts >= maxChallengeAttempts ? failedAt : null,
    });
    return attempts;
  }

  async completeSetup(tokenHash: string, factor: TwoFactorSetupRecord, completedAt: string): Promise<string | null> {
    const challenge = this.challenges.get(tokenHash);
    if (
      !challenge
      || challenge.mode !== "setup"
      || challenge.userId !== factor.userId
      || !available(challenge, new Date(completedAt).getTime())
      || this.factors.has(factor.userId)
    ) return null;
    this.factors.set(factor.userId, {
      ...structuredClone(factor),
      updatedAt: completedAt,
    });
    this.challenges.set(tokenHash, { ...challenge, consumedAt: completedAt });
    return factor.userId;
  }

  async completeTotp(tokenHash: string, counter: number, completedAt: string): Promise<string | null> {
    const challenge = this.challenges.get(tokenHash);
    if (!challenge || challenge.mode !== "verify" || !available(challenge, new Date(completedAt).getTime())) return null;
    const factor = this.factors.get(challenge.userId);
    if (!factor || (factor.lastUsedCounter !== null && factor.lastUsedCounter >= counter)) return null;
    this.factors.set(factor.userId, { ...factor, lastUsedCounter: counter, updatedAt: completedAt });
    this.challenges.set(tokenHash, { ...challenge, consumedAt: completedAt });
    return factor.userId;
  }

  async completeRecovery(tokenHash: string, recoveryCodeHash: string, completedAt: string): Promise<string | null> {
    const challenge = this.challenges.get(tokenHash);
    if (!challenge || challenge.mode !== "verify" || !available(challenge, new Date(completedAt).getTime())) return null;
    const factor = this.factors.get(challenge.userId);
    if (!factor || !factor.recoveryCodeHashes.includes(recoveryCodeHash)) return null;
    this.factors.set(factor.userId, {
      ...factor,
      recoveryCodeHashes: factor.recoveryCodeHashes.filter((hash) => hash !== recoveryCodeHash),
      updatedAt: completedAt,
    });
    this.challenges.set(tokenHash, { ...challenge, consumedAt: completedAt });
    return factor.userId;
  }

  async createRecoveryRequest(
    tokenHash: string,
    input: TwoFactorRecoveryRequestInput,
  ): Promise<TwoFactorRecoveryRecord | null> {
    const challenge = this.challenges.get(tokenHash);
    const now = new Date(input.createdAt).getTime();
    if (!challenge || challenge.mode !== "verify" || !available(challenge, now)) return null;
    for (const [id, record] of this.recoveries) {
      if (record.status === "pending" && new Date(record.expiresAt).getTime() <= now) {
        this.recoveries.set(id, { ...record, status: "expired", updatedAt: input.createdAt });
      }
    }
    const existing = [...this.recoveries.values()].find((record) => (
      record.userId === challenge.userId && record.status === "pending"
    ));
    this.challenges.set(tokenHash, { ...challenge, consumedAt: input.createdAt });
    if (existing) return cloneRecovery(existing);
    const record: TwoFactorRecoveryRecord = {
      id: input.id,
      userId: challenge.userId,
      status: "pending",
      requestIp: input.requestIp,
      requestUserAgent: input.requestUserAgent,
      expiresAt: input.expiresAt,
      reviewedBy: null,
      reviewComment: "",
      reviewedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.recoveries.set(record.id, record);
    return cloneRecovery(record);
  }

  async listRecoveryRequests(
    status: TwoFactorRecoveryQueryStatus,
    limit: number,
    listedAt: string,
  ): Promise<TwoFactorRecoveryRecord[]> {
    const now = new Date(listedAt).getTime();
    for (const [id, record] of this.recoveries) {
      if (record.status === "pending" && new Date(record.expiresAt).getTime() <= now) {
        this.recoveries.set(id, { ...record, status: "expired", updatedAt: listedAt });
      }
    }
    return [...this.recoveries.values()]
      .filter((record) => status === "all" || record.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(cloneRecovery);
  }

  async getRecoveryRequest(requestId: string, listedAt: string): Promise<TwoFactorRecoveryRecord | null> {
    const current = this.recoveries.get(requestId);
    if (!current) return null;
    if (current.status === "pending" && new Date(current.expiresAt).getTime() <= new Date(listedAt).getTime()) {
      const expired = { ...current, status: "expired" as const, updatedAt: listedAt };
      this.recoveries.set(requestId, expired);
      return cloneRecovery(expired);
    }
    return cloneRecovery(current);
  }

  async decideRecoveryRequest(
    requestId: string,
    actorId: string,
    decision: TwoFactorRecoveryDecision,
    comment: string,
    decidedAt: string,
  ): Promise<TwoFactorRecoveryDecisionResult | null> {
    const current = this.recoveries.get(requestId);
    if (!current || current.status !== "pending" || current.userId === actorId) return null;
    if (new Date(current.expiresAt).getTime() <= new Date(decidedAt).getTime()) {
      const expired = { ...current, status: "expired" as const, updatedAt: decidedAt };
      this.recoveries.set(requestId, expired);
      return { record: cloneRecovery(expired), factorReset: false };
    }
    const record: TwoFactorRecoveryRecord = {
      ...current,
      status: decision,
      reviewedBy: actorId,
      reviewComment: comment,
      reviewedAt: decidedAt,
      updatedAt: decidedAt,
    };
    this.recoveries.set(requestId, record);
    if (decision === "approved") {
      this.factors.delete(current.userId);
      for (const [hash, challenge] of this.challenges) {
        if (challenge.userId === current.userId && challenge.consumedAt === null) {
          this.challenges.set(hash, { ...challenge, consumedAt: decidedAt });
        }
      }
    }
    return { record: cloneRecovery(record), factorReset: decision === "approved" };
  }
}

interface FactorRow extends QueryResultRow {
  user_id: string;
  secret_ciphertext: string;
  recovery_code_hashes: string[];
  last_used_counter: string | number | null;
  enabled_at: Date | string;
  updated_at: Date | string;
}

interface ChallengeRow extends QueryResultRow {
  id: string;
  user_id: string;
  token_hash: string;
  mode: TwoFactorChallengeMode;
  pending_secret_ciphertext: string | null;
  attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date | string;
}

interface RecoveryRow extends QueryResultRow {
  id: string;
  user_id: string;
  status: TwoFactorRecoveryStatus;
  request_ip: string | null;
  request_user_agent: string | null;
  expires_at: Date | string;
  reviewed_by: string | null;
  review_comment: string;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function factorFromRow(row: FactorRow): TwoFactorRecord {
  return {
    userId: row.user_id,
    secretCiphertext: row.secret_ciphertext,
    recoveryCodeHashes: row.recovery_code_hashes,
    lastUsedCounter: row.last_used_counter === null ? null : Number(row.last_used_counter),
    enabledAt: iso(row.enabled_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function challengeFromRow(row: ChallengeRow): TwoFactorChallengeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    mode: row.mode,
    pendingSecretCiphertext: row.pending_secret_ciphertext,
    attempts: row.attempts,
    expiresAt: iso(row.expires_at)!,
    consumedAt: iso(row.consumed_at),
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: iso(row.created_at)!,
  };
}

function recoveryFromRow(row: RecoveryRow): TwoFactorRecoveryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    requestIp: row.request_ip,
    requestUserAgent: row.request_user_agent,
    expiresAt: iso(row.expires_at)!,
    reviewedBy: row.reviewed_by,
    reviewComment: row.review_comment,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

const challengeColumns = `
  id::text, user_id::text, token_hash, mode, pending_secret_ciphertext, attempts,
  expires_at, consumed_at, host(ip)::text as ip, user_agent, created_at
`;

const recoveryColumns = `
  id::text, user_id::text, status, host(request_ip)::text as request_ip,
  request_user_agent, expires_at, reviewed_by::text, review_comment,
  reviewed_at, created_at, updated_at
`;

export class PostgresTwoFactorRepository implements TwoFactorRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async getFactor(userId: string): Promise<TwoFactorRecord | null> {
    const result = await this.pool.query<FactorRow>(`/* rooms:get-two-factor */
      select user_id::text, secret_ciphertext, recovery_code_hashes, last_used_counter, enabled_at, updated_at
      from user_two_factor where user_id = $1::uuid
    `, [userId]);
    return result.rows[0] ? factorFromRow(result.rows[0]) : null;
  }

  async createChallenge(input: TwoFactorChallengeRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`
        update two_factor_challenges
        set consumed_at = coalesce(consumed_at, $2::timestamptz)
        where user_id = $1::uuid and consumed_at is null
      `, [input.userId, input.createdAt]);
      await client.query(`/* rooms:create-two-factor-challenge */
        insert into two_factor_challenges (
          id, user_id, token_hash, mode, pending_secret_ciphertext,
          attempts, expires_at, consumed_at, ip, user_agent, created_at
        ) values (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz,
          null, $8::inet, $9, $10::timestamptz
        )
      `, [
        input.id,
        input.userId,
        input.tokenHash,
        input.mode,
        input.pendingSecretCiphertext,
        input.attempts,
        input.expiresAt,
        input.ip,
        input.userAgent,
        input.createdAt,
      ]);
      await client.query("delete from two_factor_challenges where expires_at < now() - interval '7 days'");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createRecoveryRequest(
    tokenHash: string,
    input: TwoFactorRecoveryRequestInput,
  ): Promise<TwoFactorRecoveryRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const challenge = await this.lockVerificationChallenge(client, tokenHash, input.createdAt);
      if (!challenge) {
        await client.query("rollback");
        return null;
      }
      await client.query(`
        update two_factor_recovery_requests
        set status = 'expired', updated_at = $2::timestamptz
        where user_id = $1::uuid and status = 'pending' and expires_at <= $2::timestamptz
      `, [challenge.userId, input.createdAt]);
      const existing = await client.query<RecoveryRow>(`
        select ${recoveryColumns}
        from two_factor_recovery_requests
        where user_id = $1::uuid and status = 'pending'
        order by created_at desc
        limit 1
        for update
      `, [challenge.userId]);
      await this.consumeChallenge(client, challenge.id, input.createdAt);
      if (existing.rows[0]) {
        await client.query("commit");
        return recoveryFromRow(existing.rows[0]);
      }
      const inserted = await client.query<RecoveryRow>(`/* rooms:create-two-factor-recovery */
        insert into two_factor_recovery_requests (
          id, user_id, status, request_ip, request_user_agent, expires_at,
          reviewed_by, review_comment, reviewed_at, created_at, updated_at
        ) values (
          $1::uuid, $2::uuid, 'pending', $3::inet, $4, $5::timestamptz,
          null, '', null, $6::timestamptz, $6::timestamptz
        )
        returning ${recoveryColumns}
      `, [
        input.id,
        challenge.userId,
        input.requestIp,
        input.requestUserAgent,
        input.expiresAt,
        input.createdAt,
      ]);
      const record = inserted.rows[0];
      if (!record) throw new Error("PostgreSQL did not return the created two-factor recovery request.");
      await this.auditRecovery(client, challenge.userId, "two_factor_recovery_requested", input.id, {
        expiresAt: input.expiresAt,
        requestIp: input.requestIp,
      });
      await client.query("commit");
      return recoveryFromRow(record);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecoveryRequests(
    status: TwoFactorRecoveryQueryStatus,
    limit: number,
    listedAt: string,
  ): Promise<TwoFactorRecoveryRecord[]> {
    await this.pool.query(`
      update two_factor_recovery_requests
      set status = 'expired', updated_at = $1::timestamptz
      where status = 'pending' and expires_at <= $1::timestamptz
    `, [listedAt]);
    const result = await this.pool.query<RecoveryRow>(`/* rooms:list-two-factor-recovery */
      select ${recoveryColumns}
      from two_factor_recovery_requests
      where ($1 = 'all' or status = $1)
      order by
        case when status = 'pending' then 0 else 1 end,
        created_at desc
      limit $2
    `, [status, limit]);
    return result.rows.map(recoveryFromRow);
  }

  async getRecoveryRequest(requestId: string, listedAt: string): Promise<TwoFactorRecoveryRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<RecoveryRow>(`
        select ${recoveryColumns}
        from two_factor_recovery_requests
        where id = $1::uuid
        for update
      `, [requestId]);
      const current = result.rows[0];
      if (!current) {
        await client.query("rollback");
        return null;
      }
      if (current.status === "pending" && new Date(current.expires_at).getTime() <= new Date(listedAt).getTime()) {
        const expired = await client.query<RecoveryRow>(`
          update two_factor_recovery_requests
          set status = 'expired', updated_at = $2::timestamptz
          where id = $1::uuid
          returning ${recoveryColumns}
        `, [requestId, listedAt]);
        await client.query("commit");
        return recoveryFromRow(expired.rows[0]!);
      }
      await client.query("commit");
      return recoveryFromRow(current);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async decideRecoveryRequest(
    requestId: string,
    actorId: string,
    decision: TwoFactorRecoveryDecision,
    comment: string,
    decidedAt: string,
  ): Promise<TwoFactorRecoveryDecisionResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const selected = await client.query<RecoveryRow>(`
        select ${recoveryColumns}
        from two_factor_recovery_requests
        where id = $1::uuid
        for update
      `, [requestId]);
      const currentRow = selected.rows[0];
      if (!currentRow || currentRow.status !== "pending" || currentRow.user_id === actorId) {
        await client.query("rollback");
        return null;
      }
      if (new Date(currentRow.expires_at).getTime() <= new Date(decidedAt).getTime()) {
        const expired = await client.query<RecoveryRow>(`
          update two_factor_recovery_requests
          set status = 'expired', updated_at = $2::timestamptz
          where id = $1::uuid
          returning ${recoveryColumns}
        `, [requestId, decidedAt]);
        await client.query("commit");
        return { record: recoveryFromRow(expired.rows[0]!), factorReset: false };
      }
      if (decision === "approved") {
        const removed = await client.query(`
          delete from user_two_factor
          where user_id = $1::uuid
          returning user_id
        `, [currentRow.user_id]);
        if ((removed.rowCount ?? 0) !== 1) {
          await client.query("rollback");
          return null;
        }
        await client.query(`
          update two_factor_challenges
          set consumed_at = coalesce(consumed_at, $2::timestamptz)
          where user_id = $1::uuid
        `, [currentRow.user_id, decidedAt]);
        await client.query(`
          update user_sessions
          set revoked_at = coalesce(revoked_at, $2::timestamptz)
          where user_id = $1::uuid
        `, [currentRow.user_id, decidedAt]);
      }
      const updated = await client.query<RecoveryRow>(`/* rooms:decide-two-factor-recovery */
        update two_factor_recovery_requests
        set status = $2,
          reviewed_by = $3::uuid,
          review_comment = $4,
          reviewed_at = $5::timestamptz,
          updated_at = $5::timestamptz
        where id = $1::uuid
        returning ${recoveryColumns}
      `, [requestId, decision, actorId, comment, decidedAt]);
      const record = updated.rows[0];
      if (!record) throw new Error("PostgreSQL did not return the decided two-factor recovery request.");
      await this.auditRecovery(client, actorId, `two_factor_recovery_${decision}`, requestId, {
        targetUserId: currentRow.user_id,
        comment,
        sessionsRevoked: decision === "approved",
      });
      await client.query("commit");
      return { record: recoveryFromRow(record), factorReset: decision === "approved" };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getChallenge(tokenHash: string): Promise<TwoFactorChallengeRecord | null> {
    const result = await this.pool.query<ChallengeRow>(`/* rooms:get-two-factor-challenge */
      select ${challengeColumns}
      from two_factor_challenges
      where token_hash = $1
      limit 1
    `, [tokenHash]);
    return result.rows[0] ? challengeFromRow(result.rows[0]) : null;
  }

  async failChallenge(tokenHash: string, failedAt: string): Promise<number | null> {
    const result = await this.pool.query<{ attempts: number }>(`/* rooms:fail-two-factor-challenge */
      update two_factor_challenges
      set attempts = attempts + 1,
        consumed_at = case when attempts + 1 >= ${maxChallengeAttempts} then $2::timestamptz else null end
      where token_hash = $1
        and consumed_at is null
        and expires_at > $2::timestamptz
        and attempts < ${maxChallengeAttempts}
      returning attempts
    `, [tokenHash, failedAt]);
    return result.rows[0]?.attempts ?? null;
  }

  async completeSetup(tokenHash: string, factor: TwoFactorSetupRecord, completedAt: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const challenge = await client.query<{ user_id: string }>(`/* rooms:complete-two-factor-setup-challenge */
        update two_factor_challenges
        set consumed_at = $3::timestamptz
        where token_hash = $1
          and user_id = $2::uuid
          and mode = 'setup'
          and consumed_at is null
          and expires_at > $3::timestamptz
          and attempts < ${maxChallengeAttempts}
        returning user_id::text
      `, [tokenHash, factor.userId, completedAt]);
      const userId = challenge.rows[0]?.user_id;
      if (!userId) {
        await client.query("rollback");
        return null;
      }
      const inserted = await client.query(`/* rooms:enable-two-factor */
        insert into user_two_factor (
          user_id, secret_ciphertext, recovery_code_hashes, last_used_counter, enabled_at, updated_at
        ) values ($1::uuid, $2, $3::text[], $4::bigint, $5::timestamptz, $5::timestamptz)
        on conflict (user_id) do nothing
        returning user_id
      `, [
        factor.userId,
        factor.secretCiphertext,
        factor.recoveryCodeHashes,
        factor.lastUsedCounter,
        factor.enabledAt,
      ]);
      if ((inserted.rowCount ?? 0) !== 1) {
        await client.query("rollback");
        return null;
      }
      await this.audit(client, factor.userId, "two_factor_enabled", {
        recoveryCodes: factor.recoveryCodeHashes.length,
      });
      await client.query("commit");
      return factor.userId;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeTotp(tokenHash: string, counter: number, completedAt: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const challenge = await this.lockVerificationChallenge(client, tokenHash, completedAt);
      if (!challenge) {
        await client.query("rollback");
        return null;
      }
      const factor = await client.query(`/* rooms:consume-two-factor-counter */
        update user_two_factor
        set last_used_counter = $2::bigint, updated_at = $3::timestamptz
        where user_id = $1::uuid
          and (last_used_counter is null or last_used_counter < $2::bigint)
        returning user_id
      `, [challenge.userId, counter, completedAt]);
      if ((factor.rowCount ?? 0) !== 1) {
        await client.query("rollback");
        return null;
      }
      await this.consumeChallenge(client, challenge.id, completedAt);
      await this.audit(client, challenge.userId, "two_factor_verified", { method: "totp" });
      await client.query("commit");
      return challenge.userId;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeRecovery(tokenHash: string, recoveryCodeHash: string, completedAt: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const challenge = await this.lockVerificationChallenge(client, tokenHash, completedAt);
      if (!challenge) {
        await client.query("rollback");
        return null;
      }
      const factor = await client.query(`/* rooms:consume-two-factor-recovery */
        update user_two_factor
        set recovery_code_hashes = array_remove(recovery_code_hashes, $2), updated_at = $3::timestamptz
        where user_id = $1::uuid and $2 = any(recovery_code_hashes)
        returning user_id
      `, [challenge.userId, recoveryCodeHash, completedAt]);
      if ((factor.rowCount ?? 0) !== 1) {
        await client.query("rollback");
        return null;
      }
      await this.consumeChallenge(client, challenge.id, completedAt);
      await this.audit(client, challenge.userId, "two_factor_verified", { method: "recovery_code" });
      await client.query("commit");
      return challenge.userId;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockVerificationChallenge(
    client: import("pg").PoolClient,
    tokenHash: string,
    completedAt: string,
  ): Promise<{ id: string; userId: string } | null> {
    const result = await client.query<{ id: string; user_id: string }>(`
      select id::text, user_id::text
      from two_factor_challenges
      where token_hash = $1
        and mode = 'verify'
        and consumed_at is null
        and expires_at > $2::timestamptz
        and attempts < ${maxChallengeAttempts}
      for update
    `, [tokenHash, completedAt]);
    return result.rows[0] ? { id: result.rows[0].id, userId: result.rows[0].user_id } : null;
  }

  private consumeChallenge(client: import("pg").PoolClient, challengeId: string, completedAt: string): Promise<unknown> {
    return client.query(
      "update two_factor_challenges set consumed_at = $2::timestamptz where id = $1::uuid",
      [challengeId, completedAt],
    );
  }

  private audit(
    client: import("pg").PoolClient,
    userId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<unknown> {
    return client.query(`
      insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, after_data)
      select id, role, $2, 'user_two_factor', id::text, $3::jsonb
      from users where id = $1::uuid
    `, [userId, action, JSON.stringify(details)]);
  }

  private auditRecovery(
    client: import("pg").PoolClient,
    actorId: string,
    action: string,
    requestId: string,
    details: Record<string, unknown>,
  ): Promise<unknown> {
    return client.query(`
      insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, after_data)
      select id, role, $2, 'two_factor_recovery', $3, $4::jsonb
      from users where id = $1::uuid
    `, [actorId, action, requestId, JSON.stringify(details)]);
  }
}

export class TwoFactorCipher {
  private readonly key: Buffer;
  private readonly associatedData = Buffer.from("rooms-two-factor-v1", "utf8");

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("TWO_FACTOR_ENCRYPTION_KEY must contain at least 32 bytes.");
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.associatedData);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  decrypt(value: string): string {
    const [prefix, version, ivValue, tagValue, encryptedValue] = value.split(":");
    if (prefix !== "enc" || version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
      throw new Error("Invalid encrypted two-factor secret.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAAD(this.associatedData);
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  }

  hashRecoveryCode(value: string): string {
    return createHmac("sha256", this.key).update(normalizeRecoveryCode(value), "utf8").digest("hex");
  }
}

function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-F0-9]/gu, "");
}

function recoveryCode(): string {
  const value = randomBytes(8).toString("hex").toUpperCase();
  return value.match(/.{1,4}/gu)!.join("-");
}

function authenticator(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "Rooms",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

function qrDataUrl(value: string): string {
  const qr = qrcode(0, "M");
  qr.addData(value, "Byte");
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export class TwoFactorService {
  private readonly requiredRoles: ReadonlySet<UserRole>;

  constructor(
    private readonly repository: TwoFactorRepository,
    private readonly cipher: TwoFactorCipher,
    requiredRoles: Iterable<UserRole>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.requiredRoles = new Set(requiredRoles);
  }

  requiredFor(role: UserRole): boolean {
    return this.requiredRoles.has(role);
  }

  async status(userId: string, role: UserRole): Promise<TwoFactorStatus> {
    const factor = await this.repository.getFactor(userId);
    return {
      required: this.requiredFor(role),
      enabled: Boolean(factor),
      enabledAt: factor?.enabledAt ?? null,
      recoveryCodesRemaining: factor?.recoveryCodeHashes.length ?? 0,
    };
  }

  async begin(user: AuthUser, ip: string | null, userAgent: string | null): Promise<TwoFactorChallengePayload> {
    const factor = await this.repository.getFactor(user.id);
    const setupRequired = !factor;
    const secret = setupRequired ? new OTPAuth.Secret({ size: 20 }).base32 : null;
    const createdAt = this.now().toISOString();
    const token = randomBytes(32).toString("base64url");
    await this.repository.createChallenge({
      id: randomUUID(),
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      mode: setupRequired ? "setup" : "verify",
      pendingSecretCiphertext: secret ? this.cipher.encrypt(secret) : null,
      attempts: 0,
      expiresAt: new Date(new Date(createdAt).getTime() + twoFactorChallengeLifetimeSeconds * 1000).toISOString(),
      consumedAt: null,
      ip,
      userAgent,
      createdAt,
    });
    const base: TwoFactorChallengePayload = {
      twoFactorRequired: true,
      setupRequired,
      challengeToken: token,
      expiresIn: twoFactorChallengeLifetimeSeconds,
    };
    if (!secret) return base;
    const otpAuthUrl = authenticator(secret, user.email ?? user.phone ?? user.id).toString();
    return {
      ...base,
      setup: {
        secret,
        otpAuthUrl,
        qrDataUrl: qrDataUrl(otpAuthUrl),
      },
    };
  }

  async requestRecovery(
    challengeToken: string,
    requestIp: string | null,
    requestUserAgent: string | null,
  ): Promise<TwoFactorRecoveryRecord> {
    const createdAt = this.now().toISOString();
    const record = await this.repository.createRecoveryRequest(
      createHash("sha256").update(challengeToken).digest("hex"),
      {
        id: randomUUID(),
        requestIp,
        requestUserAgent,
        expiresAt: new Date(new Date(createdAt).getTime() + twoFactorRecoveryLifetimeSeconds * 1000).toISOString(),
        createdAt,
      },
    );
    if (!record) {
      throw new TwoFactorError(
        410,
        "TWO_FACTOR_RECOVERY_UNAVAILABLE",
        "The two-factor recovery request is unavailable.",
      );
    }
    return record;
  }

  listRecoveryRequests(
    status: TwoFactorRecoveryQueryStatus,
    limit: number,
  ): Promise<TwoFactorRecoveryRecord[]> {
    return this.repository.listRecoveryRequests(status, limit, this.now().toISOString());
  }

  getRecoveryRequest(requestId: string): Promise<TwoFactorRecoveryRecord | null> {
    return this.repository.getRecoveryRequest(requestId, this.now().toISOString());
  }

  decideRecoveryRequest(
    requestId: string,
    actorId: string,
    decision: TwoFactorRecoveryDecision,
    comment: string,
  ): Promise<TwoFactorRecoveryDecisionResult | null> {
    return this.repository.decideRecoveryRequest(
      requestId,
      actorId,
      decision,
      comment,
      this.now().toISOString(),
    );
  }

  async complete(challengeToken: string, code: string): Promise<TwoFactorCompletion> {
    const completedAt = this.now().toISOString();
    const tokenHash = createHash("sha256").update(challengeToken).digest("hex");
    const challenge = await this.repository.getChallenge(tokenHash);
    if (!challenge || !available(challenge, new Date(completedAt).getTime())) {
      throw new TwoFactorError(410, "TWO_FACTOR_CHALLENGE_UNAVAILABLE", "The two-factor challenge is unavailable.");
    }
    const factor = challenge.mode === "setup" ? null : await this.repository.getFactor(challenge.userId);
    const secretCiphertext = challenge.mode === "setup" ? challenge.pendingSecretCiphertext : factor?.secretCiphertext;
    if (!secretCiphertext) {
      throw new TwoFactorError(410, "TWO_FACTOR_CHALLENGE_UNAVAILABLE", "The two-factor challenge is unavailable.");
    }

    const normalizedTotp = code.replace(/\s/gu, "");
    if (/^\d{6}$/u.test(normalizedTotp)) {
      const secret = this.cipher.decrypt(secretCiphertext);
      const token = authenticator(secret, challenge.userId);
      const delta = token.validate({ token: normalizedTotp, window: 1, timestamp: new Date(completedAt).getTime() });
      if (delta !== null) {
        const counter = token.counter({ timestamp: new Date(completedAt).getTime() }) + delta;
        if (challenge.mode === "setup") {
          const recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
          const userId = await this.repository.completeSetup(tokenHash, {
            userId: challenge.userId,
            secretCiphertext,
            recoveryCodeHashes: recoveryCodes.map((item) => this.cipher.hashRecoveryCode(item)),
            lastUsedCounter: counter,
            enabledAt: completedAt,
          }, completedAt);
          if (userId) return { userId, recoveryCodes, usedRecoveryCode: false };
        } else {
          const userId = await this.repository.completeTotp(tokenHash, counter, completedAt);
          if (userId) return { userId, recoveryCodes: null, usedRecoveryCode: false };
        }
      }
    } else if (challenge.mode === "verify" && /^[A-F0-9-]{16,24}$/iu.test(code.trim())) {
      const userId = await this.repository.completeRecovery(
        tokenHash,
        this.cipher.hashRecoveryCode(code),
        completedAt,
      );
      if (userId) return { userId, recoveryCodes: null, usedRecoveryCode: true };
    }

    await this.repository.failChallenge(tokenHash, completedAt);
    throw new TwoFactorError(401, "TWO_FACTOR_CODE_INVALID", "The two-factor code is invalid.");
  }
}
