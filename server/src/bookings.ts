import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { LegalAcceptance } from "./auth.js";
import type { PaymentMethod, PublicationStatus } from "./types.js";

export type BookingStatus = "pending" | "proposed" | "awaiting_payment" | "paid" | "expired" | "cancelled" | "visited" | "completed";
export type BookingStatusGroup = "active" | "completed" | "cancelled" | "all";

export interface BookingVenue {
  id: string;
  slug: string;
  title: string;
  city: string;
  address: string;
  paymentMethods: PaymentMethod[];
  publicationStatus: PublicationStatus;
  partnerMode: "catalog" | "crm";
}

export interface BookingRoom {
  id: string;
  slug: string;
  title: string;
  type: string;
  capacityMax: number;
  pricePerHour: number;
  amount: number;
  isPrimary: boolean;
}

export interface BookingService {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantity: number;
  amount: number;
}

export interface BookingMoney {
  roomTotal: number;
  serviceTotal: number;
  total: number;
  prepayment: number;
  remainingOnSite: number;
  currency: "RUB";
}

export interface BookingRecord {
  id: string;
  publicNumber: string;
  status: BookingStatus;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  venue: BookingVenue;
  rooms: BookingRoom[];
  services: BookingService[];
  startsAt: string;
  endsAt: string;
  guests: number;
  eventType: string | null;
  eventName: string | null;
  onSitePaymentMethod: PaymentMethod;
  comment: string;
  money: BookingMoney;
  paymentHoldExpiresAt: string | null;
  createdAt: string;
}

export interface BookingCreateInput {
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  venue: BookingVenue;
  rooms: BookingRoom[];
  services: BookingService[];
  startsAt: string;
  endsAt: string;
  guests: number;
  eventType: string | null;
  eventName: string | null;
  onSitePaymentMethod: PaymentMethod;
  comment: string;
  money: BookingMoney;
  commission: number;
  partnerAmount: number;
  legal: LegalAcceptance;
  ip: string | null;
  userAgent: string | null;
}

export interface BookingRepository {
  readonly storage: "memory" | "postgresql";
  create(input: BookingCreateInput): Promise<BookingRecord>;
  listByClient(clientId: string, group: BookingStatusGroup): Promise<BookingRecord[]>;
}

function statusInGroup(status: BookingStatus, group: BookingStatusGroup): boolean {
  if (group === "all") return true;
  if (group === "active") return ["pending", "proposed", "awaiting_payment", "paid"].includes(status);
  if (group === "completed") return ["visited", "completed"].includes(status);
  return ["cancelled", "expired"].includes(status);
}

function publicNumber(id: string, createdAt: string): string {
  return `R-${createdAt.slice(0, 10).replaceAll("-", "")}-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function newRecord(input: BookingCreateInput): BookingRecord {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return {
    id,
    publicNumber: publicNumber(id, createdAt),
    status: "pending",
    clientId: input.clientId,
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    clientEmail: input.clientEmail,
    venue: structuredClone(input.venue),
    rooms: structuredClone(input.rooms),
    services: structuredClone(input.services),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    guests: input.guests,
    eventType: input.eventType,
    eventName: input.eventName,
    onSitePaymentMethod: input.onSitePaymentMethod,
    comment: input.comment,
    money: structuredClone(input.money),
    paymentHoldExpiresAt: null,
    createdAt,
  };
}

export class MemoryBookingRepository implements BookingRepository {
  readonly storage = "memory" as const;
  private readonly bookings: BookingRecord[] = [];

  async create(input: BookingCreateInput): Promise<BookingRecord> {
    const record = newRecord(input);
    this.bookings.unshift(record);
    return structuredClone(record);
  }

  async listByClient(clientId: string, group: BookingStatusGroup): Promise<BookingRecord[]> {
    return structuredClone(this.bookings.filter((booking) => booking.clientId === clientId && statusInGroup(booking.status, group)));
  }
}

interface BookingRow extends QueryResultRow {
  id: string;
  public_number: string;
  status: BookingStatus;
  client_id: string;
  client_name: string;
  client_phone: string;
  client_email: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  guests: number;
  event_type: string | null;
  event_name: string | null;
  on_site_payment_method: PaymentMethod | null;
  comment: string | null;
  room_total: string | number;
  service_total: string | number;
  total: string | number;
  prepayment: string | number;
  remaining_on_site: string | number;
  payment_hold_expires_at: Date | string | null;
  created_at: Date | string;
  venue_id: string;
  venue_slug: string;
  venue_title: string;
  city: string;
  venue_address: string;
  payment_methods: PaymentMethod[];
  publication_status: PublicationStatus;
  partner_mode: "catalog" | "crm";
}

interface BookingRoomRow extends QueryResultRow {
  booking_id: string;
  room_id: string;
  slug: string | null;
  title_snapshot: string;
  room_type: string | null;
  capacity_max: number | null;
  price_per_hour_snapshot: string | number;
  amount: string | number;
  is_primary: boolean;
}

interface BookingServiceRow extends QueryResultRow {
  booking_id: string;
  service_id: string;
  name_snapshot: string;
  description_snapshot: string | null;
  unit_price: string | number;
  quantity: number;
  amount: string | number;
}

function number(value: string | number): number {
  return Number(value) || 0;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class PostgresBookingRepository implements BookingRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async create(input: BookingCreateInput): Promise<BookingRecord> {
    const record = newRecord(input);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`/* rooms:create-booking */
        insert into bookings (
          id, public_number, client_id, venue_id, status, client_name, client_phone, client_email,
          city, event_type, event_name, guests, starts_at, ends_at, room_total, service_total,
          total, prepayment, commission, partner_amount, remaining_on_site,
          on_site_payment_method, comment, created_at, updated_at
        ) values (
          $1::uuid,$2,$3::uuid,$4::uuid,'pending',$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz,
          $14,$15,$16,$17,$18,$19,$20,$21,$22,$23::timestamptz,$23::timestamptz
        )
      `, [
        record.id, record.publicNumber, input.clientId, input.venue.id, input.clientName, input.clientPhone,
        input.clientEmail, input.venue.city, input.eventType, input.eventName, input.guests, input.startsAt,
        input.endsAt, input.money.roomTotal, input.money.serviceTotal, input.money.total, input.money.prepayment,
        input.commission, input.partnerAmount, input.money.remainingOnSite, input.onSitePaymentMethod,
        input.comment || null, record.createdAt,
      ]);
      for (const room of input.rooms) await this.insertRoom(client, record.id, room);
      for (const service of input.services) await this.insertService(client, record.id, service);
      await this.insertConsent(client, record.id, input);
      await client.query("commit");
      return record;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listByClient(clientId: string, group: BookingStatusGroup): Promise<BookingRecord[]> {
    const result = await this.pool.query<BookingRow>(`/* rooms:list-client-bookings */
      select b.id::text, b.public_number, b.status, b.client_id::text, b.client_name,
        b.client_phone, b.client_email::text, b.starts_at, b.ends_at, b.guests,
        b.event_type, b.event_name, b.on_site_payment_method, b.comment,
        b.room_total, b.service_total, b.total, b.prepayment, b.remaining_on_site,
        b.payment_hold_expires_at, b.created_at,
        v.id::text as venue_id, v.slug as venue_slug, v.title as venue_title,
        b.city, v.address as venue_address, v.payment_methods,
        v.publication_status, v.partner_mode
      from bookings b
      join venues v on v.id = b.venue_id
      where b.client_id = $1::uuid
      order by b.created_at desc
      limit 100
    `, [clientId]);
    const filtered = result.rows.filter((row) => statusInGroup(row.status, group));
    return this.hydrate(filtered);
  }

  private async hydrate(rows: BookingRow[]): Promise<BookingRecord[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [roomResult, serviceResult] = await Promise.all([
      this.pool.query<BookingRoomRow>(`/* rooms:booking-rooms */
        select br.booking_id::text, br.room_id::text, r.slug, br.title_snapshot,
          r.room_type, r.capacity_max, br.price_per_hour_snapshot, br.amount, br.is_primary
        from booking_rooms br
        left join rooms r on r.id = br.room_id
        where br.booking_id = any($1::uuid[])
        order by br.booking_id, br.is_primary desc, br.title_snapshot
      `, [ids]),
      this.pool.query<BookingServiceRow>(`/* rooms:booking-services */
        select bs.booking_id::text, coalesce(bs.room_service_id, bs.id)::text as service_id,
          bs.name_snapshot, bs.description_snapshot, bs.unit_price, bs.quantity, bs.amount
        from booking_services bs
        where bs.booking_id = any($1::uuid[])
        order by bs.booking_id, bs.name_snapshot
      `, [ids]),
    ]);
    const rooms = new Map<string, BookingRoom[]>();
    for (const row of roomResult.rows) {
      const items = rooms.get(row.booking_id) ?? [];
      items.push({
        id: row.room_id,
        slug: row.slug ?? row.room_id,
        title: row.title_snapshot,
        type: row.room_type ?? "room",
        capacityMax: Number(row.capacity_max) || 1,
        pricePerHour: number(row.price_per_hour_snapshot),
        amount: number(row.amount),
        isPrimary: row.is_primary,
      });
      rooms.set(row.booking_id, items);
    }
    const services = new Map<string, BookingService[]>();
    for (const row of serviceResult.rows) {
      const items = services.get(row.booking_id) ?? [];
      items.push({
        id: row.service_id,
        name: row.name_snapshot,
        description: row.description_snapshot,
        price: number(row.unit_price),
        quantity: row.quantity,
        amount: number(row.amount),
      });
      services.set(row.booking_id, items);
    }
    return rows.map((row) => ({
      id: row.id,
      publicNumber: row.public_number,
      status: row.status,
      clientId: row.client_id,
      clientName: row.client_name,
      clientPhone: row.client_phone,
      clientEmail: row.client_email,
      venue: {
        id: row.venue_id,
        slug: row.venue_slug,
        title: row.venue_title,
        city: row.city,
        address: row.venue_address,
        paymentMethods: row.payment_methods,
        publicationStatus: row.publication_status,
        partnerMode: row.partner_mode,
      },
      rooms: rooms.get(row.id) ?? [],
      services: services.get(row.id) ?? [],
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      guests: row.guests,
      eventType: row.event_type,
      eventName: row.event_name,
      onSitePaymentMethod: row.on_site_payment_method ?? "card",
      comment: row.comment ?? "",
      money: {
        roomTotal: number(row.room_total),
        serviceTotal: number(row.service_total),
        total: number(row.total),
        prepayment: number(row.prepayment),
        remainingOnSite: number(row.remaining_on_site),
        currency: "RUB",
      },
      paymentHoldExpiresAt: row.payment_hold_expires_at === null ? null : iso(row.payment_hold_expires_at),
      createdAt: iso(row.created_at),
    }));
  }

  private async insertRoom(client: PoolClient, bookingId: string, room: BookingRoom): Promise<void> {
    await client.query(`
      insert into booking_rooms (booking_id, room_id, title_snapshot, price_per_hour_snapshot, amount, is_primary)
      values ($1::uuid,$2::uuid,$3,$4,$5,$6)
    `, [bookingId, room.id, room.title, room.pricePerHour, room.amount, room.isPrimary]);
  }

  private async insertService(client: PoolClient, bookingId: string, service: BookingService): Promise<void> {
    await client.query(`
      insert into booking_services (
        booking_id, room_service_id, name_snapshot, description_snapshot, unit_price, quantity, amount
      ) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7)
    `, [bookingId, service.id, service.name, service.description, service.price, service.quantity, service.amount]);
  }

  private async insertConsent(client: PoolClient, bookingId: string, input: BookingCreateInput): Promise<void> {
    const version = input.legal.termsVersion === input.legal.privacyVersion
      ? input.legal.termsVersion
      : `terms:${input.legal.termsVersion};privacy:${input.legal.privacyVersion}`;
    await client.query(`
      insert into personal_data_consents (
        user_id, booking_id, subject_phone, subject_email, context, documents,
        document_version, ip, user_agent, accepted_at
      ) values ($1::uuid,$2::uuid,$3,$4,'booking',array['terms','privacy'],$5,$6::inet,$7,$8::timestamptz)
    `, [input.clientId, bookingId, input.clientPhone, input.clientEmail, version, input.ip, input.userAgent, input.legal.acceptedAt]);
  }
}
