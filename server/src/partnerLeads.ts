import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";

export type PartnerLeadStatus = "new" | "review" | "approved" | "rejected";
export type PartnerLeadQueryStatus = PartnerLeadStatus | "all";

export interface PartnerLeadInput {
  city: string;
  venueTitle: string;
  address: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  venueType: string;
  roomCount: number;
  comment: string;
  termsVersion: string;
  privacyVersion: string;
  consentedAt: string;
  requestIp: string | null;
  requestUserAgent: string | null;
}

export interface PartnerLeadRecord extends PartnerLeadInput {
  id: string;
  status: PartnerLeadStatus;
  reviewedBy: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerLeadRepository {
  readonly storage: "memory" | "postgresql";
  create(input: PartnerLeadInput): Promise<PartnerLeadRecord>;
  findById(leadId: string): Promise<PartnerLeadRecord | null>;
  list(status: PartnerLeadQueryStatus, limit: number): Promise<PartnerLeadRecord[]>;
  decide(adminId: string, leadId: string, status: Exclude<PartnerLeadStatus, "new">, comment: string): Promise<PartnerLeadRecord | null>;
}

export class PartnerLeadConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "PARTNER_LEAD_EXISTS";

  constructor() {
    super("An active partner application with this email or phone already exists.");
  }
}

export class PartnerLeadStateError extends Error {
  readonly statusCode = 409;
  readonly code = "PARTNER_LEAD_STATE_CHANGED";

  constructor() {
    super("The partner application has already received a final decision.");
  }
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sameContact(record: PartnerLeadRecord, input: PartnerLeadInput): boolean {
  return record.status !== "rejected"
    && (record.contactEmail.toLocaleLowerCase("ru-RU") === input.contactEmail.toLocaleLowerCase("ru-RU")
      || record.contactPhone === input.contactPhone);
}

export class MemoryPartnerLeadRepository implements PartnerLeadRepository {
  readonly storage = "memory" as const;
  private readonly records: PartnerLeadRecord[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: PartnerLeadInput): Promise<PartnerLeadRecord> {
    if (this.records.some((record) => sameContact(record, input))) throw new PartnerLeadConflictError();
    const timestamp = this.now().toISOString();
    const record: PartnerLeadRecord = {
      ...structuredClone(input),
      id: randomUUID(),
      status: "new",
      reviewedBy: null,
      reviewComment: null,
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.unshift(record);
    return structuredClone(record);
  }

  async list(status: PartnerLeadQueryStatus, limit: number): Promise<PartnerLeadRecord[]> {
    const rank: Record<PartnerLeadStatus, number> = { new: 0, review: 1, approved: 2, rejected: 3 };
    return this.records
      .filter((record) => status === "all" || record.status === status)
      .sort((left, right) => rank[left.status] - rank[right.status] || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async findById(leadId: string): Promise<PartnerLeadRecord | null> {
    const record = this.records.find((item) => item.id === leadId);
    return record ? structuredClone(record) : null;
  }

  async decide(
    adminId: string,
    leadId: string,
    status: Exclude<PartnerLeadStatus, "new">,
    comment: string,
  ): Promise<PartnerLeadRecord | null> {
    const record = this.records.find((item) => item.id === leadId);
    if (!record) return null;
    if (["approved", "rejected"].includes(record.status) && record.status !== status) throw new PartnerLeadStateError();
    if (record.status === status) return structuredClone(record);
    const timestamp = this.now().toISOString();
    record.status = status;
    record.reviewedBy = status === "review" ? null : adminId;
    record.reviewComment = comment.trim() || null;
    record.reviewedAt = status === "review" ? null : timestamp;
    record.updatedAt = timestamp;
    return structuredClone(record);
  }
}

interface PartnerLeadRow extends QueryResultRow {
  id: string;
  city: string;
  venue_title: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  venue_type: string;
  room_count: number;
  comment: string;
  status: PartnerLeadStatus;
  terms_version: string;
  privacy_version: string;
  consented_at: Date | string;
  request_ip: string | null;
  request_user_agent: string | null;
  reviewed_by: string | null;
  review_comment: string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const PARTNER_LEAD_SELECT = `
  select id::text, city, venue_title, address, contact_name, contact_phone,
    contact_email::text, venue_type, room_count, comment, status::text,
    terms_version, privacy_version, consented_at, request_ip::text,
    request_user_agent, reviewed_by::text, review_comment, reviewed_at,
    created_at, updated_at
  from partner_leads
`;

function recordFromRow(row: PartnerLeadRow): PartnerLeadRecord {
  return {
    id: row.id,
    city: row.city,
    venueTitle: row.venue_title,
    address: row.address,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    venueType: row.venue_type,
    roomCount: Number(row.room_count),
    comment: row.comment,
    status: row.status,
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    consentedAt: iso(row.consented_at)!,
    requestIp: row.request_ip,
    requestUserAgent: row.request_user_agent,
    reviewedBy: row.reviewed_by,
    reviewComment: row.review_comment,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

export class PostgresPartnerLeadRepository implements PartnerLeadRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async create(input: PartnerLeadInput): Promise<PartnerLeadRecord> {
    try {
      const result = await this.pool.query<PartnerLeadRow>(`/* rooms:create-partner-lead */
        insert into partner_leads (
          city, venue_title, address, contact_name, contact_phone, contact_email,
          venue_type, room_count, comment, terms_version, privacy_version,
          consented_at, request_ip, request_user_agent
        ) values ($1,$2,$3,$4,$5,$6::citext,$7,$8,$9,$10,$11,$12::timestamptz,$13::inet,$14)
        returning id::text, city, venue_title, address, contact_name, contact_phone,
          contact_email::text, venue_type, room_count, comment, status::text,
          terms_version, privacy_version, consented_at, request_ip::text,
          request_user_agent, reviewed_by::text, review_comment, reviewed_at,
          created_at, updated_at
      `, [
        input.city, input.venueTitle, input.address, input.contactName, input.contactPhone,
        input.contactEmail, input.venueType, input.roomCount, input.comment,
        input.termsVersion, input.privacyVersion, input.consentedAt, input.requestIp,
        input.requestUserAgent,
      ]);
      return recordFromRow(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new PartnerLeadConflictError();
      throw error;
    }
  }

  async list(status: PartnerLeadQueryStatus, limit: number): Promise<PartnerLeadRecord[]> {
    const result = await this.pool.query<PartnerLeadRow>(`${PARTNER_LEAD_SELECT}
      where ($1::text = 'all' or status::text = $1::text)
      order by case status when 'new' then 0 when 'review' then 1 when 'approved' then 2 else 3 end,
        updated_at desc
      limit $2
    `, [status, limit]);
    return result.rows.map(recordFromRow);
  }

  async findById(leadId: string): Promise<PartnerLeadRecord | null> {
    const result = await this.pool.query<PartnerLeadRow>(`${PARTNER_LEAD_SELECT} where id = $1::uuid`, [leadId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async decide(
    adminId: string,
    leadId: string,
    status: Exclude<PartnerLeadStatus, "new">,
    comment: string,
  ): Promise<PartnerLeadRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query<PartnerLeadRow>(`${PARTNER_LEAD_SELECT}
        where id = $1::uuid for update
      `, [leadId]);
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("rollback");
        return null;
      }
      if (["approved", "rejected"].includes(current.status) && current.status !== status) throw new PartnerLeadStateError();
      if (current.status !== status) {
        await client.query(`/* rooms:decide-partner-lead */
          update partner_leads
          set status = $2::partner_lead_status,
            reviewed_by = case when $2 = 'review' then null else $3::uuid end,
            review_comment = nullif($4, ''),
            reviewed_at = case when $2 = 'review' then null else now() end,
            updated_at = now()
          where id = $1::uuid
        `, [leadId, status, adminId, comment.trim()]);
        await client.query(`
          insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data)
          values ($1::uuid,'admin','partner_lead_status_changed','partner_lead',$2,$3::jsonb,$4::jsonb)
        `, [
          adminId,
          leadId,
          JSON.stringify({ status: current.status }),
          JSON.stringify({ status, comment: comment.trim() || null }),
        ]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const result = await this.pool.query<PartnerLeadRow>(`${PARTNER_LEAD_SELECT} where id = $1::uuid`, [leadId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }
}
