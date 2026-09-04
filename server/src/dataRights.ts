import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";

export type PersonalDataRequestType = "access" | "rectification" | "restriction" | "consent_withdrawal" | "erasure";
export type PersonalDataRequestStatus = "new" | "processing" | "completed" | "rejected";
export type PersonalDataRequestQueryStatus = PersonalDataRequestStatus | "all";

export interface PersonalDataRequestRecord {
  id: string;
  userId: string;
  type: PersonalDataRequestType;
  status: PersonalDataRequestStatus;
  message: string;
  resolution: string | null;
  dueAt: string;
  assignedTo: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalDataConsentRecord {
  id: string;
  context: string;
  documents: string[];
  documentVersion: string;
  acceptedAt: string;
  createdAt: string;
}

export interface DataRightsRepository {
  readonly storage: "memory" | "postgresql";
  create(userId: string, type: PersonalDataRequestType, message: string): Promise<PersonalDataRequestRecord>;
  listForUser(userId: string): Promise<PersonalDataRequestRecord[]>;
  listAdmin(status: PersonalDataRequestQueryStatus, limit: number): Promise<PersonalDataRequestRecord[]>;
  decide(adminId: string, requestId: string, status: Exclude<PersonalDataRequestStatus, "new">, resolution: string): Promise<PersonalDataRequestRecord | null>;
  listConsents(userId: string): Promise<PersonalDataConsentRecord[]>;
}

function dueAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
}

export class MemoryDataRightsRepository implements DataRightsRepository {
  readonly storage = "memory" as const;
  private readonly requests = new Map<string, PersonalDataRequestRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(userId: string, type: PersonalDataRequestType, message: string): Promise<PersonalDataRequestRecord> {
    const duplicate = [...this.requests.values()].find((item) => item.userId === userId && item.type === type
      && ["new", "processing"].includes(item.status));
    if (duplicate) return structuredClone(duplicate);
    const createdAt = this.now().toISOString();
    const record: PersonalDataRequestRecord = {
      id: randomUUID(), userId, type, status: "new", message, resolution: null,
      dueAt: dueAt(createdAt), assignedTo: null, resolvedAt: null, createdAt, updatedAt: createdAt,
    };
    this.requests.set(record.id, record);
    return structuredClone(record);
  }

  async listForUser(userId: string): Promise<PersonalDataRequestRecord[]> {
    return [...this.requests.values()].filter((item) => item.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((item) => structuredClone(item));
  }

  async listAdmin(status: PersonalDataRequestQueryStatus, limit: number): Promise<PersonalDataRequestRecord[]> {
    return [...this.requests.values()].filter((item) => status === "all" || item.status === status)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt)).slice(0, limit).map((item) => structuredClone(item));
  }

  async decide(adminId: string, requestId: string, status: Exclude<PersonalDataRequestStatus, "new">, resolution: string): Promise<PersonalDataRequestRecord | null> {
    const current = this.requests.get(requestId);
    if (!current) return null;
    const updatedAt = this.now().toISOString();
    const final = status === "completed" || status === "rejected";
    const updated = { ...current, status, resolution: resolution || null, assignedTo: adminId,
      resolvedAt: final ? updatedAt : null, updatedAt };
    this.requests.set(requestId, updated);
    return structuredClone(updated);
  }

  async listConsents(_userId: string): Promise<PersonalDataConsentRecord[]> {
    return [];
  }
}

interface RequestRow extends QueryResultRow {
  id: string; user_id: string; request_type: PersonalDataRequestType; status: PersonalDataRequestStatus;
  message: string; resolution: string | null; due_at: Date | string; assigned_to: string | null;
  resolved_at: Date | string | null; created_at: Date | string; updated_at: Date | string;
}

interface ConsentRow extends QueryResultRow {
  id: string; context: string; documents: string[]; document_version: string;
  accepted_at: Date | string; created_at: Date | string;
}

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const optionalIso = (value: Date | string | null) => value === null ? null : iso(value);

function requestFromRow(row: RequestRow): PersonalDataRequestRecord {
  return {
    id: row.id, userId: row.user_id, type: row.request_type, status: row.status,
    message: row.message, resolution: row.resolution, dueAt: iso(row.due_at), assignedTo: row.assigned_to,
    resolvedAt: optionalIso(row.resolved_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

export class PostgresDataRightsRepository implements DataRightsRepository {
  readonly storage = "postgresql" as const;
  constructor(private readonly pool: Pool) {}

  async create(userId: string, type: PersonalDataRequestType, message: string): Promise<PersonalDataRequestRecord> {
    const result = await this.pool.query<RequestRow>(`/* rooms:data-rights-create */
      insert into personal_data_requests (user_id, request_type, message, due_at)
      values ($1::uuid, $2::personal_data_request_type, $3, now() + interval '10 days')
      on conflict (user_id, request_type) where status in ('new','processing')
      do update set updated_at = personal_data_requests.updated_at
      returning id::text, user_id::text, request_type, status, message, resolution, due_at,
        assigned_to::text, resolved_at, created_at, updated_at
    `, [userId, type, message]);
    return requestFromRow(result.rows[0]!);
  }

  async listForUser(userId: string): Promise<PersonalDataRequestRecord[]> {
    const result = await this.pool.query<RequestRow>(`/* rooms:data-rights-list-user */
      select id::text, user_id::text, request_type, status, message, resolution, due_at,
        assigned_to::text, resolved_at, created_at, updated_at
      from personal_data_requests where user_id = $1::uuid order by created_at desc
    `, [userId]);
    return result.rows.map(requestFromRow);
  }

  async listAdmin(status: PersonalDataRequestQueryStatus, limit: number): Promise<PersonalDataRequestRecord[]> {
    const result = await this.pool.query<RequestRow>(`/* rooms:data-rights-list-admin */
      select id::text, user_id::text, request_type, status, message, resolution, due_at,
        assigned_to::text, resolved_at, created_at, updated_at
      from personal_data_requests
      where ($1 = 'all' or status::text = $1)
      order by case status when 'new' then 0 when 'processing' then 1 else 2 end, due_at, created_at
      limit $2
    `, [status, limit]);
    return result.rows.map(requestFromRow);
  }

  async decide(adminId: string, requestId: string, status: Exclude<PersonalDataRequestStatus, "new">, resolution: string): Promise<PersonalDataRequestRecord | null> {
    const final = status === "completed" || status === "rejected";
    const result = await this.pool.query<RequestRow>(`/* rooms:data-rights-decide */
      update personal_data_requests set status = $3::personal_data_request_status, resolution = nullif($4, ''), assigned_to = $2::uuid,
        resolved_at = case when $5 then now() else null end, updated_at = now()
      where id = $1::uuid
      returning id::text, user_id::text, request_type, status, message, resolution, due_at,
        assigned_to::text, resolved_at, created_at, updated_at
    `, [requestId, adminId, status, resolution, final]);
    return result.rows[0] ? requestFromRow(result.rows[0]) : null;
  }

  async listConsents(userId: string): Promise<PersonalDataConsentRecord[]> {
    const result = await this.pool.query<ConsentRow>(`/* rooms:data-rights-consents */
      select id::text, context, documents, document_version, accepted_at, created_at
      from personal_data_consents where user_id = $1::uuid order by accepted_at desc
    `, [userId]);
    return result.rows.map((row) => ({ id: row.id, context: row.context, documents: row.documents,
      documentVersion: row.document_version, acceptedAt: iso(row.accepted_at), createdAt: iso(row.created_at) }));
  }
}
