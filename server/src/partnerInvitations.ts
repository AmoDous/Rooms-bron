import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import { AuthConflictError, MemoryAuthRepository } from "./auth.js";
import { MemoryBookingRepository, type BookingVenue } from "./bookings.js";
import { MemoryPartnerCatalogRepository } from "./partnerCatalog.js";
import type { PartnerLeadRecord, PartnerLeadRepository } from "./partnerLeads.js";
import type { Venue } from "./types.js";

export const partnerInvitationLifetimeSeconds = 24 * 60 * 60;

export interface PartnerInvitationRecord {
  id: string;
  leadId: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface PartnerInvitationPreview {
  venueTitle: string;
  city: string;
  contactName: string;
  expiresAt: string;
}

export interface PartnerInvitationActivationInput {
  tokenHash: string;
  passwordHash: string;
  acceptedAt: string;
  termsVersion: string;
  privacyVersion: string;
  ip: string | null;
  userAgent: string | null;
}

export interface PartnerInvitationActivationResult {
  userId: string;
  venueId: string;
  email: string;
  venueTitle: string;
}

export interface PartnerInvitationRepository {
  readonly storage: "memory" | "postgresql";
  issue(adminId: string, leadId: string, tokenHash: string, expiresAt: string): Promise<PartnerInvitationRecord | null>;
  latestForLeads(leadIds: string[]): Promise<PartnerInvitationRecord[]>;
  preview(tokenHash: string): Promise<PartnerInvitationPreview | null>;
  activate(input: PartnerInvitationActivationInput): Promise<PartnerInvitationActivationResult | null>;
}

export class PartnerInvitationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: "PARTNER_LEAD_NOT_APPROVED" | "PARTNER_ACCOUNT_EXISTS" | "PARTNER_INVITATION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

interface MemoryPartnerInvitation extends PartnerInvitationRecord {
  tokenHash: string;
  createdBy: string;
}

function venueSlug(leadId: string): string {
  return `venue-${leadId.replaceAll("-", "").slice(0, 16).toLowerCase()}`;
}

function invitationAvailable(record: PartnerInvitationRecord): boolean {
  return record.consumedAt === null && record.revokedAt === null && new Date(record.expiresAt).getTime() > Date.now();
}

function bookingVenue(lead: PartnerLeadRecord, venueId: string): BookingVenue {
  return {
    id: venueId,
    slug: venueSlug(lead.id),
    title: lead.venueTitle,
    city: lead.city,
    address: lead.address,
    paymentMethods: ["card", "cash"],
    publicationStatus: "review",
    partnerMode: "catalog",
  };
}

export class MemoryPartnerInvitationRepository implements PartnerInvitationRepository {
  readonly storage = "memory" as const;
  private readonly records = new Map<string, MemoryPartnerInvitation>();
  private readonly activating = new Set<string>();

  constructor(
    private readonly leads: PartnerLeadRepository,
    private readonly auth: MemoryAuthRepository,
    private readonly bookings: MemoryBookingRepository,
    private readonly partnerCatalog: MemoryPartnerCatalogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(adminId: string, leadId: string, tokenHash: string, expiresAt: string): Promise<PartnerInvitationRecord | null> {
    const lead = await this.leads.findById(leadId);
    if (!lead) return null;
    if (lead.status !== "approved") {
      throw new PartnerInvitationError(409, "PARTNER_LEAD_NOT_APPROVED", "Approve the partner application before issuing an invitation.");
    }
    if (await this.auth.findUserByLogin(lead.contactEmail, lead.contactPhone)) {
      throw new PartnerInvitationError(409, "PARTNER_ACCOUNT_EXISTS", "A partner account with this email or phone already exists.");
    }
    const timestamp = this.now().toISOString();
    for (const record of this.records.values()) {
      if (record.leadId === leadId && record.consumedAt === null && record.revokedAt === null) record.revokedAt = timestamp;
    }
    const record: MemoryPartnerInvitation = {
      id: randomUUID(),
      leadId,
      tokenHash,
      createdBy: adminId,
      expiresAt,
      consumedAt: null,
      revokedAt: null,
      createdAt: timestamp,
    };
    this.records.set(tokenHash, record);
    return this.publicRecord(record);
  }

  async latestForLeads(leadIds: string[]): Promise<PartnerInvitationRecord[]> {
    const expected = new Set(leadIds);
    const latest = new Map<string, MemoryPartnerInvitation>();
    for (const record of this.records.values()) {
      if (!expected.has(record.leadId)) continue;
      const current = latest.get(record.leadId);
      if (!current || current.createdAt < record.createdAt) latest.set(record.leadId, record);
    }
    return [...latest.values()].map((record) => this.publicRecord(record));
  }

  async preview(tokenHash: string): Promise<PartnerInvitationPreview | null> {
    const invitation = this.records.get(tokenHash);
    if (!invitation || !invitationAvailable(invitation)) return null;
    const lead = await this.leads.findById(invitation.leadId);
    if (!lead || lead.status !== "approved") return null;
    return {
      venueTitle: lead.venueTitle,
      city: lead.city,
      contactName: lead.contactName,
      expiresAt: invitation.expiresAt,
    };
  }

  async activate(input: PartnerInvitationActivationInput): Promise<PartnerInvitationActivationResult | null> {
    const invitation = this.records.get(input.tokenHash);
    if (!invitation || !invitationAvailable(invitation) || this.activating.has(input.tokenHash)) return null;
    this.activating.add(input.tokenHash);
    try {
      const lead = await this.leads.findById(invitation.leadId);
      if (!lead || lead.status !== "approved") return null;
      if (await this.auth.findUserByLogin(lead.contactEmail, lead.contactPhone)) {
        throw new PartnerInvitationError(409, "PARTNER_ACCOUNT_EXISTS", "A partner account with this email or phone already exists.");
      }
      invitation.consumedAt = input.acceptedAt;
      let user;
      try {
        user = await this.auth.createPartner({
          name: lead.contactName,
          email: lead.contactEmail,
          phone: lead.contactPhone,
          city: lead.city,
          passwordHash: input.passwordHash,
        });
      } catch (error) {
        invitation.consumedAt = null;
        if (error instanceof AuthConflictError) {
          throw new PartnerInvitationError(409, "PARTNER_ACCOUNT_EXISTS", "A partner account with this email or phone already exists.");
        }
        throw error;
      }
      const venueId = randomUUID();
      const accessVenue = bookingVenue(lead, venueId);
      this.bookings.assignPartnerVenue(user.id, accessVenue);
      const venue: Venue = {
        ...accessVenue,
        description: "",
        rules: "",
        amenities: [],
      };
      this.partnerCatalog.provisionVenue(venue, {
        venueType: lead.venueType,
        name: lead.contactName,
        phone: lead.contactPhone,
        email: lead.contactEmail,
      });
      return { userId: user.id, venueId, email: lead.contactEmail, venueTitle: lead.venueTitle };
    } finally {
      this.activating.delete(input.tokenHash);
    }
  }

  private publicRecord(record: MemoryPartnerInvitation): PartnerInvitationRecord {
    return {
      id: record.id,
      leadId: record.leadId,
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
    };
  }
}

interface InvitationRow extends QueryResultRow {
  id: string;
  lead_id: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

interface InvitationPreviewRow extends QueryResultRow {
  venue_title: string;
  city: string;
  contact_name: string;
  expires_at: Date | string;
}

interface ActivationRow extends QueryResultRow {
  invitation_id: string;
  lead_id: string;
  venue_title: string;
  city: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  venue_type: string;
  terms_version: string;
  privacy_version: string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function invitationFromRow(row: InvitationRow): PartnerInvitationRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    expiresAt: iso(row.expires_at)!,
    consumedAt: iso(row.consumed_at),
    revokedAt: iso(row.revoked_at),
    createdAt: iso(row.created_at)!,
  };
}

export class PostgresPartnerInvitationRepository implements PartnerInvitationRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async issue(adminId: string, leadId: string, tokenHash: string, expiresAt: string): Promise<PartnerInvitationRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const lead = await client.query<{
        status: string;
        contact_email: string;
        contact_phone: string;
      }>(`/* rooms:lock-partner-lead-for-invitation */
        select status::text, contact_email::text, contact_phone
        from partner_leads where id = $1::uuid for update
      `, [leadId]);
      const current = lead.rows[0];
      if (!current) {
        await client.query("rollback");
        return null;
      }
      if (current.status !== "approved") {
        throw new PartnerInvitationError(409, "PARTNER_LEAD_NOT_APPROVED", "Approve the partner application before issuing an invitation.");
      }
      const duplicate = await client.query(`
        select 1 from users where email = $1::citext or phone = $2 limit 1
      `, [current.contact_email, current.contact_phone]);
      if ((duplicate.rowCount ?? 0) > 0) {
        throw new PartnerInvitationError(409, "PARTNER_ACCOUNT_EXISTS", "A partner account with this email or phone already exists.");
      }
      await client.query(`
        update partner_invitations
        set revoked_at = now()
        where lead_id = $1::uuid and consumed_at is null and revoked_at is null
      `, [leadId]);
      const inserted = await client.query<InvitationRow>(`/* rooms:issue-partner-invitation */
        insert into partner_invitations (lead_id, token_hash, expires_at, created_by)
        values ($1::uuid, $2, $3::timestamptz, $4::uuid)
        returning id::text, lead_id::text, expires_at, consumed_at, revoked_at, created_at
      `, [leadId, tokenHash, expiresAt, adminId]);
      const invitation = inserted.rows[0]!;
      await client.query(`
        insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, after_data)
        values ($1::uuid, 'admin', 'partner_invitation_issued', 'partner_invitation', $2, $3::jsonb)
      `, [adminId, invitation.id, JSON.stringify({ leadId, expiresAt: iso(invitation.expires_at) })]);
      await client.query("commit");
      return invitationFromRow(invitation);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async latestForLeads(leadIds: string[]): Promise<PartnerInvitationRecord[]> {
    if (!leadIds.length) return [];
    const result = await this.pool.query<InvitationRow>(`/* rooms:list-latest-partner-invitations */
      select distinct on (lead_id)
        id::text, lead_id::text, expires_at, consumed_at, revoked_at, created_at
      from partner_invitations
      where lead_id = any($1::uuid[])
      order by lead_id, created_at desc
    `, [leadIds]);
    return result.rows.map(invitationFromRow);
  }

  async preview(tokenHash: string): Promise<PartnerInvitationPreview | null> {
    const result = await this.pool.query<InvitationPreviewRow>(`/* rooms:preview-partner-invitation */
      select l.venue_title, l.city, l.contact_name, i.expires_at
      from partner_invitations i
      join partner_leads l on l.id = i.lead_id
      where i.token_hash = $1
        and i.consumed_at is null
        and i.revoked_at is null
        and i.expires_at > now()
        and l.status = 'approved'
      limit 1
    `, [tokenHash]);
    const row = result.rows[0];
    return row ? {
      venueTitle: row.venue_title,
      city: row.city,
      contactName: row.contact_name,
      expiresAt: iso(row.expires_at)!,
    } : null;
  }

  async activate(input: PartnerInvitationActivationInput): Promise<PartnerInvitationActivationResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const invitation = await client.query<ActivationRow>(`/* rooms:activate-partner-invitation */
        select i.id::text as invitation_id, l.id::text as lead_id, l.venue_title,
          l.city, l.address, l.contact_name, l.contact_phone, l.contact_email::text,
          l.venue_type, l.terms_version, l.privacy_version
        from partner_invitations i
        join partner_leads l on l.id = i.lead_id
        where i.token_hash = $1
          and i.consumed_at is null
          and i.revoked_at is null
          and i.expires_at > $2::timestamptz
          and l.status = 'approved'
        for update of i, l
      `, [input.tokenHash, input.acceptedAt]);
      const row = invitation.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }
      const duplicate = await client.query(`
        select 1 from users where email = $1::citext or phone = $2 limit 1
      `, [row.contact_email, row.contact_phone]);
      if ((duplicate.rowCount ?? 0) > 0) {
        throw new PartnerInvitationError(409, "PARTNER_ACCOUNT_EXISTS", "A partner account with this email or phone already exists.");
      }
      const user = await client.query<{ id: string }>(`/* rooms:create-invited-partner */
        insert into users (role, name, email, phone, city, password_hash, password_reset_required)
        values ('partner', $1, $2::citext, $3, $4, $5, false)
        returning id::text
      `, [row.contact_name, row.contact_email, row.contact_phone, row.city, input.passwordHash]);
      const userId = user.rows[0]!.id;
      const venue = await client.query<{ id: string }>(`/* rooms:create-invited-venue */
        insert into venues (
          slug, title, city, address, venue_type, description, rules,
          contact_name, contact_phone, contact_email, amenities, payment_methods,
          publication_status, verification_status, cabinet_status, partner_mode
        ) values (
          $1, $2, $3, $4, $5, '', '', $6, $7, $8::citext, '{}',
          array['card','cash']::text[], 'review', 'review', 'active', 'catalog'
        )
        returning id::text
      `, [
        venueSlug(row.lead_id), row.venue_title, row.city, row.address, row.venue_type,
        row.contact_name, row.contact_phone, row.contact_email,
      ]);
      const venueId = venue.rows[0]!.id;
      await client.query(`
        insert into venue_members (venue_id, user_id, member_role)
        values ($1::uuid, $2::uuid, 'manager')
      `, [venueId, userId]);
      const version = input.termsVersion === input.privacyVersion
        ? input.termsVersion
        : `terms:${input.termsVersion};privacy:${input.privacyVersion}`;
      await client.query(`/* rooms:create-partner-activation-consent */
        insert into personal_data_consents (
          user_id, subject_phone, subject_email, context, documents, document_version,
          ip, user_agent, accepted_at
        ) values (
          $1::uuid, $2, $3::citext, 'partner_activation', array['terms','privacy'],
          $4, $5::inet, $6, $7::timestamptz
        )
      `, [userId, row.contact_phone, row.contact_email, version, input.ip, input.userAgent, input.acceptedAt]);
      await client.query(`
        update partner_invitations
        set consumed_at = $2::timestamptz, activated_user_id = $3::uuid, activated_venue_id = $4::uuid
        where id = $1::uuid
      `, [row.invitation_id, input.acceptedAt, userId, venueId]);
      await client.query(`
        insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, after_data)
        values ($1::uuid, 'partner', 'partner_invitation_accepted', 'partner_invitation', $2, $3::jsonb)
      `, [userId, row.invitation_id, JSON.stringify({ leadId: row.lead_id, venueId })]);
      await client.query("commit");
      return { userId, venueId, email: row.contact_email, venueTitle: row.venue_title };
    } catch (error) {
      await client.query("rollback");
      if ((error as { code?: string }).code === "23505") {
        throw new PartnerInvitationError(409, "PARTNER_ACCOUNT_EXISTS", "A partner account with this email or phone already exists.");
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
