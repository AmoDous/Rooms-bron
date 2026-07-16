import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { demoRooms, demoVenues } from "./catalog.js";
import type { PaymentMethod, PublicationStatus, Room, RoomService, Venue } from "./types.js";

export interface PartnerWeekScheduleDay {
  weekday: number;
  enabled: boolean;
  opensAtHour: number;
  closesAtHour: number;
}

export interface PartnerScheduleException {
  date: string;
  mode: "closed" | "custom";
  opensAtHour: number | null;
  closesAtHour: number | null;
  note: string;
}

export interface PartnerModerationChange {
  id: string;
  fields: string[];
  beforeData: Record<string, unknown>;
  proposedData: Record<string, unknown>;
  createdAt: string;
}

export type ModerationStatus = "pending" | "approved" | "rejected";

export interface AdminModerationRecord extends PartnerModerationChange {
  targetType: "venue" | "room";
  targetId: string;
  targetTitle: string;
  venueId: string;
  venueTitle: string;
  submittedById: string | null;
  submittedByName: string | null;
  submittedByEmail: string | null;
  status: ModerationStatus;
  reviewComment: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
}

export interface AdminModerationQuery {
  status: ModerationStatus | "all";
  limit: number;
  venueId?: string;
}

export interface PartnerVenueRecord extends Venue {
  venueType: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  weekSchedule: PartnerWeekScheduleDay[];
  scheduleExceptions: PartnerScheduleException[];
  pendingChange: PartnerModerationChange | null;
}

export interface PartnerRoomRecord extends Room {
  pendingChange: PartnerModerationChange | null;
}

export interface PartnerVenueWrite {
  title: string;
  city: string;
  address: string;
  venueType: string;
  description: string;
  rules: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  amenities: string[];
  paymentMethods: PaymentMethod[];
  weekSchedule: PartnerWeekScheduleDay[];
}

export interface PartnerRoomServiceWrite {
  id?: string;
  name: string;
  description: string;
  price: number;
}

export interface PartnerRoomWrite {
  title: string;
  subtitle: string;
  type: string;
  description: string;
  rules: string;
  promotion: string;
  capacityMin: number;
  capacityMax: number;
  pricePerHour: number;
  minimumHours: number;
  bufferMinutes: 0 | 15 | 30 | 45 | 60;
  opensAtHour: number;
  closesAtHour: number;
  features: string[];
  tags: string[];
  services: PartnerRoomServiceWrite[];
  status: PublicationStatus;
}

export interface PartnerScheduleExceptionWrite {
  mode: "closed" | "custom";
  opensAtHour: number | null;
  closesAtHour: number | null;
  note: string;
}

export interface PartnerCatalogRepository {
  readonly storage: "memory" | "postgresql";
  getVenue(venueId: string): Promise<PartnerVenueRecord | null>;
  updateVenue(venueId: string, actorId: string, input: PartnerVenueWrite): Promise<PartnerVenueRecord | null>;
  listRooms(venueId: string): Promise<PartnerRoomRecord[]>;
  createRoom(venueId: string, actorId: string, input: PartnerRoomWrite): Promise<PartnerRoomRecord>;
  updateRoom(venueId: string, roomId: string, actorId: string, input: PartnerRoomWrite): Promise<PartnerRoomRecord | null>;
  setScheduleException(
    venueId: string,
    actorId: string,
    date: string,
    input: PartnerScheduleExceptionWrite,
  ): Promise<PartnerVenueRecord | null>;
  deleteScheduleException(venueId: string, actorId: string, date: string): Promise<PartnerVenueRecord | null>;
  listModeration(query: AdminModerationQuery): Promise<AdminModerationRecord[]>;
  decideModeration(
    moderationId: string,
    actorId: string,
    decision: Exclude<ModerationStatus, "pending">,
    comment: string,
  ): Promise<AdminModerationRecord | null>;
}

export class PartnerCatalogError extends Error {
  readonly statusCode = 409;

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

interface VenueDetailsRow extends QueryResultRow {
  id: string;
  slug: string;
  title: string;
  city: string;
  address: string;
  venue_type: string | null;
  description: string | null;
  rules: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  amenities: string[] | null;
  payment_methods: PaymentMethod[] | null;
  publication_status: PublicationStatus;
  partner_mode: "catalog" | "crm";
}

interface RoomDetailsRow extends QueryResultRow {
  id: string;
  slug: string;
  venue_id: string;
  title: string;
  subtitle: string | null;
  room_type: string;
  description: string | null;
  rules: string | null;
  promotion: string | null;
  capacity_min: number;
  capacity_max: number;
  price_per_hour: number | string;
  minimum_hours: number | string;
  rating_cached: number | string;
  review_count_cached: number | string;
  opens_at: string;
  closes_at: string;
  closes_next_day: boolean;
  buffer_minutes: 0 | 15 | 30 | 45 | 60;
  features: string[] | null;
  tags: string[] | null;
  publication_status: PublicationStatus;
}

interface WeekScheduleRow extends QueryResultRow {
  weekday: number;
  enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  closes_next_day: boolean;
}

interface ExceptionRow extends QueryResultRow {
  local_date: Date | string;
  mode: "closed" | "custom";
  opens_at: string | null;
  closes_at: string | null;
  closes_next_day: boolean;
  note: string | null;
}

interface PhotoRow extends QueryResultRow {
  room_id: string;
  url: string;
}

interface ServiceRow extends QueryResultRow {
  room_id: string;
  id: string;
  name: string;
  description: string | null;
  price: number | string;
}

interface ModerationRow extends QueryResultRow {
  id: string;
  room_id: string | null;
  fields: string[];
  before_data: Record<string, unknown>;
  proposed_data: Record<string, unknown>;
  created_at: Date | string;
}

interface AdminModerationRow extends ModerationRow {
  venue_id: string | null;
  target_type: "venue" | "room";
  target_id: string;
  target_title: string;
  target_venue_id: string;
  venue_title: string;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  status: ModerationStatus;
  reviewed_by: string | null;
  review_comment: string | null;
  reviewed_at: Date | string | null;
}

interface MemoryModerationRecord {
  change: PartnerModerationChange;
  targetType: "venue" | "room";
  targetId: string;
  venueId: string;
  submittedById: string;
  status: ModerationStatus;
  reviewComment: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clockHour(value: string | null, nextDay = false): number {
  if (!value) return 0;
  const [hours = "0", minutes = "0"] = value.split(":");
  return numeric(hours) + numeric(minutes) / 60 + (nextDay ? 24 : 0);
}

function hourToClock(value: number): string {
  const minutes = Math.round((((value % 24) + 24) % 24) * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isoDateTime(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value ?? {});
}

function changedFields(before: Record<string, unknown>, proposed: Record<string, unknown>): string[] {
  return Object.keys(proposed).filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(proposed[field] ?? null));
}

function normalizedServices(services: PartnerRoomServiceWrite[]): RoomService[] {
  const used = new Set<string>();
  return services.map((service) => {
    let id = service.id && UUID_PATTERN.test(service.id) ? service.id : randomUUID();
    if (used.has(id)) id = randomUUID();
    used.add(id);
    return { id, name: service.name.trim(), description: service.description.trim() || null, price: numeric(service.price) };
  });
}

function venueProposal(input: PartnerVenueWrite): Record<string, unknown> {
  return {
    title: input.title.trim(),
    city: input.city.trim(),
    address: input.address.trim(),
    venueType: input.venueType.trim(),
    description: input.description.trim(),
    rules: input.rules.trim(),
    amenities: [...input.amenities],
    paymentMethods: [...input.paymentMethods],
  };
}

function venueBefore(row: VenueDetailsRow): Record<string, unknown> {
  return {
    title: row.title,
    city: row.city,
    address: row.address,
    venueType: row.venue_type ?? "",
    description: row.description ?? "",
    rules: row.rules ?? "",
    amenities: row.amenities ?? [],
    paymentMethods: row.payment_methods ?? ["card", "cash"],
  };
}

function roomProposal(input: PartnerRoomWrite, services: RoomService[]): Record<string, unknown> {
  return {
    title: input.title.trim(),
    subtitle: input.subtitle.trim(),
    type: input.type.trim(),
    description: input.description.trim(),
    rules: input.rules.trim(),
    promotion: input.promotion.trim(),
    capacityMin: input.capacityMin,
    capacityMax: input.capacityMax,
    pricePerHour: input.pricePerHour,
    features: [...input.features],
    tags: [...input.tags],
    services: services.map((service) => ({ ...service })),
  };
}

function roomBefore(row: RoomDetailsRow, services: RoomService[]): Record<string, unknown> {
  return {
    title: row.title,
    subtitle: row.subtitle ?? "",
    type: row.room_type,
    description: row.description ?? "",
    rules: row.rules ?? "",
    promotion: row.promotion ?? "",
    capacityMin: numeric(row.capacity_min),
    capacityMax: numeric(row.capacity_max),
    pricePerHour: numeric(row.price_per_hour),
    features: row.features ?? [],
    tags: row.tags ?? [],
    services: services.map((service) => ({ ...service })),
  };
}

function moderationFromRow(row: ModerationRow | undefined): PartnerModerationChange | null {
  return row ? {
    id: row.id,
    fields: [...row.fields],
    beforeData: cloneObject(row.before_data),
    proposedData: cloneObject(row.proposed_data),
    createdAt: isoDateTime(row.created_at),
  } : null;
}

function adminModerationFromRow(row: AdminModerationRow): AdminModerationRecord {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title,
    venueId: row.target_venue_id,
    venueTitle: row.venue_title,
    submittedById: row.submitted_by,
    submittedByName: row.submitted_by_name,
    submittedByEmail: row.submitted_by_email,
    fields: [...row.fields],
    beforeData: cloneObject(row.before_data),
    proposedData: cloneObject(row.proposed_data),
    status: row.status,
    reviewComment: row.review_comment,
    reviewedById: row.reviewed_by,
    reviewedAt: row.reviewed_at ? isoDateTime(row.reviewed_at) : null,
    createdAt: isoDateTime(row.created_at),
  };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return numeric(typeof value === "number" || typeof value === "string" ? value : 0);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function paymentMethodsValue(value: unknown): PaymentMethod[] {
  return stringArray(value).filter((item): item is PaymentMethod => item === "card" || item === "cash");
}

function servicesValue(value: unknown): RoomService[] {
  if (!Array.isArray(value)) return [];
  return normalizedServices(value.map((item) => {
    const service = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      ...(typeof service.id === "string" ? { id: service.id } : {}),
      name: textValue(service.name),
      description: textValue(service.description),
      price: numberValue(service.price),
    };
  }).filter((service) => service.name));
}

function defaultWeekSchedule(opensAtHour = 10, closesAtHour = 24): PartnerWeekScheduleDay[] {
  return Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    enabled: true,
    opensAtHour,
    closesAtHour,
  }));
}

export class MemoryPartnerCatalogRepository implements PartnerCatalogRepository {
  readonly storage = "memory" as const;
  private readonly venues = new Map(demoVenues.map((venue) => [venue.id, structuredClone(venue)]));
  private readonly rooms = new Map(demoRooms.map((room) => [room.id, structuredClone(room)]));
  private readonly contacts = new Map<string, { venueType: string; name: string; phone: string; email: string }>();
  private readonly schedules = new Map<string, PartnerWeekScheduleDay[]>();
  private readonly exceptions = new Map<string, PartnerScheduleException[]>();
  private readonly venueModeration = new Map<string, PartnerModerationChange>();
  private readonly roomModeration = new Map<string, PartnerModerationChange>();
  private readonly moderationRecords = new Map<string, MemoryModerationRecord>();

  private queueMemoryModeration(
    targetType: "venue" | "room",
    targetId: string,
    venueId: string,
    actorId: string,
    beforeData: Record<string, unknown>,
    proposedData: Record<string, unknown>,
  ): PartnerModerationChange | null {
    const target = targetType === "venue" ? this.venueModeration : this.roomModeration;
    const current = target.get(targetId);
    const original = current?.beforeData ?? structuredClone(beforeData);
    const proposed = { ...(current?.proposedData ?? {}), ...structuredClone(proposedData) };
    const fields = changedFields(original, proposed);
    if (!fields.length) {
      if (current) this.moderationRecords.delete(current.id);
      target.delete(targetId);
      return null;
    }
    const change: PartnerModerationChange = {
      id: current?.id ?? randomUUID(),
      fields,
      beforeData: structuredClone(original),
      proposedData: proposed,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    };
    target.set(targetId, change);
    this.moderationRecords.set(change.id, {
      change,
      targetType,
      targetId,
      venueId,
      submittedById: actorId,
      status: "pending",
      reviewComment: null,
      reviewedById: null,
      reviewedAt: null,
    });
    return change;
  }

  private memoryAdminRecord(item: MemoryModerationRecord): AdminModerationRecord | null {
    const venue = this.venues.get(item.venueId);
    const target = item.targetType === "venue" ? venue : this.rooms.get(item.targetId);
    if (!venue || !target) return null;
    return {
      ...structuredClone(item.change),
      targetType: item.targetType,
      targetId: item.targetId,
      targetTitle: target.title,
      venueId: venue.id,
      venueTitle: venue.title,
      submittedById: item.submittedById,
      submittedByName: null,
      submittedByEmail: null,
      status: item.status,
      reviewComment: item.reviewComment,
      reviewedById: item.reviewedById,
      reviewedAt: item.reviewedAt,
    };
  }

  async getVenue(venueId: string): Promise<PartnerVenueRecord | null> {
    const venue = this.venues.get(venueId);
    if (!venue) return null;
    const contact = this.contacts.get(venueId) ?? { venueType: "", name: "", phone: "", email: "" };
    return {
      ...structuredClone(venue),
      venueType: contact.venueType,
      contactName: contact.name,
      contactPhone: contact.phone,
      contactEmail: contact.email,
      weekSchedule: structuredClone(this.schedules.get(venueId) ?? defaultWeekSchedule()),
      scheduleExceptions: structuredClone(this.exceptions.get(venueId) ?? []),
      pendingChange: structuredClone(this.venueModeration.get(venueId) ?? null),
    };
  }

  async updateVenue(venueId: string, actorId: string, input: PartnerVenueWrite): Promise<PartnerVenueRecord | null> {
    const venue = this.venues.get(venueId);
    if (!venue) return null;
    const before = {
      title: venue.title,
      city: venue.city,
      address: venue.address,
      venueType: this.contacts.get(venueId)?.venueType ?? "",
      description: venue.description,
      rules: venue.rules,
      amenities: venue.amenities,
      paymentMethods: venue.paymentMethods,
    };
    const proposed = venueProposal(input);
    this.queueMemoryModeration("venue", venueId, venueId, actorId, before, proposed);
    this.contacts.set(venueId, {
      venueType: input.venueType.trim(), name: input.contactName.trim(), phone: input.contactPhone.trim(), email: input.contactEmail.trim(),
    });
    this.schedules.set(venueId, structuredClone(input.weekSchedule));
    return this.getVenue(venueId);
  }

  async listRooms(venueId: string): Promise<PartnerRoomRecord[]> {
    return [...this.rooms.values()].filter((room) => room.venueId === venueId).map((room) => ({
      ...structuredClone(room),
      pendingChange: structuredClone(this.roomModeration.get(room.id) ?? null),
    }));
  }

  async createRoom(venueId: string, actorId: string, input: PartnerRoomWrite): Promise<PartnerRoomRecord> {
    const id = randomUUID();
    const services = normalizedServices(input.services);
    const room: Room = {
      id,
      slug: `room-${id.slice(0, 8)}`,
      venueId,
      title: input.title.trim(),
      subtitle: input.subtitle.trim(),
      type: input.type.trim(),
      capacityMin: input.capacityMin,
      capacityMax: input.capacityMax,
      pricePerHour: input.pricePerHour,
      minimumHours: input.minimumHours,
      rating: 0,
      reviewCount: 0,
      description: input.description.trim(),
      rules: input.rules.trim(),
      promotion: input.promotion.trim() || null,
      features: [...input.features],
      tags: [...input.tags],
      photoPaths: [],
      services,
      opensAtHour: input.opensAtHour,
      closesAtHour: input.closesAtHour,
      bufferMinutes: input.bufferMinutes,
      defaultBlocked: [],
      blockedByDate: {},
      publicationStatus: "review",
    };
    this.rooms.set(id, room);
    const proposed = { ...roomProposal(input, services), publicationRequested: true };
    this.queueMemoryModeration("room", id, venueId, actorId, {}, proposed);
    return { ...structuredClone(room), pendingChange: structuredClone(this.roomModeration.get(id) ?? null) };
  }

  async updateRoom(venueId: string, roomId: string, actorId: string, input: PartnerRoomWrite): Promise<PartnerRoomRecord | null> {
    const room = this.rooms.get(roomId);
    if (!room || room.venueId !== venueId) return null;
    const services = normalizedServices(input.services);
    const before = roomBefore({
      id: room.id, slug: room.slug, venue_id: room.venueId, title: room.title, subtitle: room.subtitle,
      room_type: room.type, description: room.description, rules: room.rules, promotion: room.promotion,
      capacity_min: room.capacityMin, capacity_max: room.capacityMax, price_per_hour: room.pricePerHour,
      minimum_hours: room.minimumHours, rating_cached: room.rating, review_count_cached: room.reviewCount,
      opens_at: hourToClock(room.opensAtHour), closes_at: hourToClock(room.closesAtHour),
      closes_next_day: room.closesAtHour >= 24, buffer_minutes: room.bufferMinutes, features: room.features,
      tags: room.tags, publication_status: room.publicationStatus,
    }, room.services);
    const proposed = roomProposal(input, services);
    const fields = changedFields(before, proposed);
    const published = room.publicationStatus === "published";
    const next: Room = {
      ...room,
      minimumHours: input.minimumHours,
      opensAtHour: input.opensAtHour,
      closesAtHour: input.closesAtHour,
      bufferMinutes: input.bufferMinutes,
      publicationStatus: input.status === "hidden" ? "hidden" : room.publicationStatus,
      ...(!published ? {
        title: input.title.trim(), subtitle: input.subtitle.trim(), type: input.type.trim(), description: input.description.trim(),
        rules: input.rules.trim(), promotion: input.promotion.trim() || null, capacityMin: input.capacityMin,
        capacityMax: input.capacityMax, pricePerHour: input.pricePerHour, features: [...input.features],
        tags: [...input.tags], services, publicationStatus: input.status === "hidden" ? "hidden" : "review" as const,
      } : {}),
    };
    this.rooms.set(roomId, next);
    if (fields.length || (!published && input.status !== "hidden")) {
      const proposedData = { ...proposed, ...(!published && input.status !== "hidden" ? { publicationRequested: true } : {}) };
      this.queueMemoryModeration("room", roomId, venueId, actorId, before, proposedData);
    } else {
      const current = this.roomModeration.get(roomId);
      if (current) this.moderationRecords.delete(current.id);
      this.roomModeration.delete(roomId);
    }
    return { ...structuredClone(next), pendingChange: structuredClone(this.roomModeration.get(roomId) ?? null) };
  }

  async setScheduleException(
    venueId: string,
    _actorId: string,
    date: string,
    input: PartnerScheduleExceptionWrite,
  ): Promise<PartnerVenueRecord | null> {
    if (!this.venues.has(venueId)) return null;
    const list = (this.exceptions.get(venueId) ?? []).filter((item) => item.date !== date);
    list.push({ date, mode: input.mode, opensAtHour: input.opensAtHour, closesAtHour: input.closesAtHour, note: input.note.trim() });
    this.exceptions.set(venueId, list.sort((left, right) => left.date.localeCompare(right.date)));
    return this.getVenue(venueId);
  }

  async deleteScheduleException(venueId: string, _actorId: string, date: string): Promise<PartnerVenueRecord | null> {
    if (!this.venues.has(venueId)) return null;
    this.exceptions.set(venueId, (this.exceptions.get(venueId) ?? []).filter((item) => item.date !== date));
    return this.getVenue(venueId);
  }

  async listModeration(query: AdminModerationQuery): Promise<AdminModerationRecord[]> {
    return [...this.moderationRecords.values()]
      .filter((item) => query.status === "all" || item.status === query.status)
      .filter((item) => !query.venueId || item.venueId === query.venueId)
      .map((item) => this.memoryAdminRecord(item))
      .filter((item): item is AdminModerationRecord => item !== null)
      .sort((left, right) => Number(right.status === "pending") - Number(left.status === "pending")
        || right.createdAt.localeCompare(left.createdAt))
      .slice(0, query.limit);
  }

  async decideModeration(
    moderationId: string,
    actorId: string,
    decision: Exclude<ModerationStatus, "pending">,
    comment: string,
  ): Promise<AdminModerationRecord | null> {
    const item = this.moderationRecords.get(moderationId);
    if (!item) return null;
    if (item.status !== "pending") {
      throw new PartnerCatalogError("MODERATION_ALREADY_REVIEWED", "Это изменение уже обработано другим администратором.");
    }
    if (item.targetType === "venue") {
      const venue = this.venues.get(item.targetId);
      if (!venue) return null;
      if (decision === "approved") {
        const data = item.change.proposedData;
        this.venues.set(item.targetId, {
          ...venue,
          title: textValue(data.title),
          city: textValue(data.city),
          address: textValue(data.address),
          description: textValue(data.description),
          rules: textValue(data.rules),
          amenities: stringArray(data.amenities),
          paymentMethods: paymentMethodsValue(data.paymentMethods),
        });
        const contact = this.contacts.get(item.targetId) ?? { venueType: "", name: "", phone: "", email: "" };
        this.contacts.set(item.targetId, { ...contact, venueType: textValue(data.venueType) });
      }
      this.venueModeration.delete(item.targetId);
    } else {
      const room = this.rooms.get(item.targetId);
      if (!room) return null;
      const data = decision === "approved" ? item.change.proposedData : item.change.beforeData;
      const hasSnapshot = typeof data.title === "string";
      const next = hasSnapshot ? {
        ...room,
        title: textValue(data.title),
        subtitle: textValue(data.subtitle),
        type: textValue(data.type),
        description: textValue(data.description),
        rules: textValue(data.rules),
        promotion: textValue(data.promotion) || null,
        capacityMin: numberValue(data.capacityMin),
        capacityMax: numberValue(data.capacityMax),
        pricePerHour: numberValue(data.pricePerHour),
        features: stringArray(data.features),
        tags: stringArray(data.tags),
        services: servicesValue(data.services),
      } : room;
      const publicationRequested = item.change.proposedData.publicationRequested === true;
      this.rooms.set(item.targetId, {
        ...next,
        ...(publicationRequested
          ? { publicationStatus: decision === "approved" ? "published" as const : room.publicationStatus === "published" ? "published" as const : "hidden" as const }
          : {}),
      });
      this.roomModeration.delete(item.targetId);
    }
    const decided: MemoryModerationRecord = {
      ...item,
      status: decision,
      reviewComment: comment.trim() || null,
      reviewedById: actorId,
      reviewedAt: new Date().toISOString(),
    };
    this.moderationRecords.set(moderationId, decided);
    return this.memoryAdminRecord(decided);
  }
}

export class PostgresPartnerCatalogRepository implements PartnerCatalogRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async getVenue(venueId: string): Promise<PartnerVenueRecord | null> {
    const [venueResult, scheduleResult, exceptionsResult, moderationResult] = await Promise.all([
      this.pool.query<VenueDetailsRow>(`/* rooms:partner-catalog-venue */
        select v.id::text, v.slug, v.title, v.city, v.address, v.venue_type, v.description, v.rules,
          v.contact_name, v.contact_phone, v.contact_email::text, v.amenities, v.payment_methods,
          v.publication_status, v.partner_mode
        from venues v where v.id = $1::uuid
      `, [venueId]),
      this.pool.query<WeekScheduleRow>(`/* rooms:partner-week-schedule */
        select weekday, enabled, opens_at::text, closes_at::text, closes_next_day
        from venue_week_schedule where venue_id = $1::uuid order by weekday
      `, [venueId]),
      this.pool.query<ExceptionRow>(`/* rooms:partner-schedule-exceptions */
        select local_date, mode, opens_at::text, closes_at::text, closes_next_day, note
        from venue_schedule_exceptions where venue_id = $1::uuid order by local_date
      `, [venueId]),
      this.pool.query<ModerationRow>(`/* rooms:partner-venue-moderation */
        select id::text, null::text as room_id, fields, before_data, proposed_data, created_at
        from moderation_requests where venue_id = $1::uuid and status = 'pending'
        order by created_at desc limit 1
      `, [venueId]),
    ]);
    const row = venueResult.rows[0];
    if (!row) return null;
    const weekSchedule = scheduleResult.rows.length ? scheduleResult.rows.map((day) => ({
      weekday: day.weekday,
      enabled: day.enabled,
      opensAtHour: clockHour(day.opens_at),
      closesAtHour: clockHour(day.closes_at, day.closes_next_day),
    })) : defaultWeekSchedule();
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      city: row.city,
      address: row.address,
      venueType: row.venue_type ?? "",
      description: row.description ?? "",
      rules: row.rules ?? "",
      contactName: row.contact_name ?? "",
      contactPhone: row.contact_phone ?? "",
      contactEmail: row.contact_email ?? "",
      amenities: row.amenities ?? [],
      paymentMethods: row.payment_methods ?? ["card", "cash"],
      publicationStatus: row.publication_status,
      partnerMode: row.partner_mode,
      weekSchedule,
      scheduleExceptions: exceptionsResult.rows.map((item) => ({
        date: isoDate(item.local_date),
        mode: item.mode,
        opensAtHour: item.mode === "custom" ? clockHour(item.opens_at) : null,
        closesAtHour: item.mode === "custom" ? clockHour(item.closes_at, item.closes_next_day) : null,
        note: item.note ?? "",
      })),
      pendingChange: moderationFromRow(moderationResult.rows[0]),
    };
  }

  async updateVenue(venueId: string, actorId: string, input: PartnerVenueWrite): Promise<PartnerVenueRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<VenueDetailsRow>(`/* rooms:lock-partner-venue */
        select v.id::text, v.slug, v.title, v.city, v.address, v.venue_type, v.description, v.rules,
          v.contact_name, v.contact_phone, v.contact_email::text, v.amenities, v.payment_methods,
          v.publication_status, v.partner_mode
        from venues v where v.id = $1::uuid for update
      `, [venueId]);
      const row = current.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }
      await client.query(`/* rooms:update-partner-venue-operational */
        update venues set contact_name = $2, contact_phone = $3, contact_email = nullif($4, '')::citext, updated_at = now()
        where id = $1::uuid
      `, [venueId, input.contactName.trim(), input.contactPhone.trim(), input.contactEmail.trim()]);
      await this.replaceWeekSchedule(client, venueId, input.weekSchedule);
      await this.upsertModeration(client, { venueId, roomId: null }, actorId, venueBefore(row), venueProposal(input));
      await this.audit(client, actorId, "partner_venue_updated", "venue", venueId, venueBefore(row), {
        ...venueProposal(input), contactName: input.contactName.trim(), contactPhone: input.contactPhone.trim(),
        contactEmail: input.contactEmail.trim(), weekSchedule: input.weekSchedule,
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return this.getVenue(venueId);
  }

  async listRooms(venueId: string): Promise<PartnerRoomRecord[]> {
    const roomResult = await this.pool.query<RoomDetailsRow>(`/* rooms:partner-catalog-rooms */
      select r.id::text, r.slug, r.venue_id::text, r.title, r.subtitle, r.room_type, r.description, r.rules,
        r.promotion, r.capacity_min, r.capacity_max, r.price_per_hour::float8, r.minimum_hours::float8,
        r.rating_cached::float8, r.review_count_cached, r.opens_at::text, r.closes_at::text,
        r.closes_next_day, r.buffer_minutes, r.features, r.tags, r.status as publication_status
      from rooms r where r.venue_id = $1::uuid order by r.created_at, r.title
    `, [venueId]);
    if (!roomResult.rows.length) return [];
    const roomIds = roomResult.rows.map((row) => row.id);
    const [photosResult, servicesResult, moderationResult] = await Promise.all([
      this.pool.query<PhotoRow>(`/* rooms:partner-room-photos */
        select p.room_id::text, coalesce(p.landscape_url, p.original_url) as url
        from room_photos p where p.room_id = any($1::uuid[])
        order by p.room_id, p.is_cover desc, p.sort_order, p.created_at
      `, [roomIds]),
      this.pool.query<ServiceRow>(`/* rooms:partner-room-services */
        select s.room_id::text, s.id::text, s.name, s.description, s.price::float8
        from room_services s where s.room_id = any($1::uuid[]) and s.active
        order by s.room_id, s.sort_order, s.name
      `, [roomIds]),
      this.pool.query<ModerationRow>(`/* rooms:partner-room-moderation */
        select m.id::text, m.room_id::text, m.fields, m.before_data, m.proposed_data, m.created_at
        from moderation_requests m where m.room_id = any($1::uuid[]) and m.status = 'pending'
        order by m.created_at desc
      `, [roomIds]),
    ]);
    const photos = new Map<string, string[]>();
    for (const photo of photosResult.rows) photos.set(photo.room_id, [...(photos.get(photo.room_id) ?? []), photo.url]);
    const services = new Map<string, RoomService[]>();
    for (const service of servicesResult.rows) services.set(service.room_id, [...(services.get(service.room_id) ?? []), {
      id: service.id, name: service.name, description: service.description, price: numeric(service.price),
    }]);
    const moderation = new Map<string, ModerationRow>();
    for (const item of moderationResult.rows) if (item.room_id && !moderation.has(item.room_id)) moderation.set(item.room_id, item);
    return roomResult.rows.map((row) => this.roomFromRow(
      row,
      photos.get(row.id) ?? [],
      services.get(row.id) ?? [],
      moderationFromRow(moderation.get(row.id)),
    ));
  }

  async createRoom(venueId: string, actorId: string, input: PartnerRoomWrite): Promise<PartnerRoomRecord> {
    const id = randomUUID();
    const slug = `room-${id.slice(0, 8)}`;
    const services = normalizedServices(input.services);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const venue = await client.query<{ exists: boolean }>("select exists(select 1 from venues where id = $1::uuid) as exists", [venueId]);
      if (!venue.rows[0]?.exists) throw new PartnerCatalogError("PARTNER_VENUE_NOT_FOUND", "Площадка для нового помещения не найдена.");
      await client.query(`/* rooms:create-partner-room */
        insert into rooms (
          id, venue_id, slug, title, room_type, subtitle, description, rules, promotion,
          capacity_min, capacity_max, price_per_hour, minimum_hours, opens_at, closes_at,
          closes_next_day, buffer_minutes, features, tags, status
        ) values (
          $1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,nullif($9,''),$10,$11,$12,$13,$14::time,$15::time,$16,$17,$18,$19,'review'
        )
      `, [
        id, venueId, slug, input.title.trim(), input.type.trim(), input.subtitle.trim(), input.description.trim(),
        input.rules.trim(), input.promotion.trim(), input.capacityMin, input.capacityMax, input.pricePerHour,
        input.minimumHours, hourToClock(input.opensAtHour), hourToClock(input.closesAtHour),
        input.closesAtHour >= 24, input.bufferMinutes, input.features, input.tags,
      ]);
      await this.replaceServices(client, id, services);
      const proposed = { ...roomProposal(input, services), publicationRequested: true };
      await this.upsertModeration(client, { venueId: null, roomId: id }, actorId, {}, proposed);
      await this.audit(client, actorId, "partner_room_created", "room", id, {}, proposed);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const room = (await this.listRooms(venueId)).find((item) => item.id === id);
    if (!room) throw new Error("Created partner room could not be loaded.");
    return room;
  }

  async updateRoom(venueId: string, roomId: string, actorId: string, input: PartnerRoomWrite): Promise<PartnerRoomRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query<RoomDetailsRow>(`/* rooms:lock-partner-room */
        select r.id::text, r.slug, r.venue_id::text, r.title, r.subtitle, r.room_type, r.description, r.rules,
          r.promotion, r.capacity_min, r.capacity_max, r.price_per_hour::float8, r.minimum_hours::float8,
          r.rating_cached::float8, r.review_count_cached, r.opens_at::text, r.closes_at::text,
          r.closes_next_day, r.buffer_minutes, r.features, r.tags, r.status as publication_status
        from rooms r where r.id = $1::uuid and r.venue_id = $2::uuid for update
      `, [roomId, venueId]);
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("rollback");
        return null;
      }
      const currentServices = await this.loadServices(client, roomId);
      const services = normalizedServices(input.services);
      const before = roomBefore(current, currentServices);
      const proposed = roomProposal(input, services);
      const published = current.publication_status === "published";
      if (published) {
        await client.query(`/* rooms:update-partner-room-operational */
          update rooms set minimum_hours = $3, opens_at = $4::time, closes_at = $5::time,
            closes_next_day = $6, buffer_minutes = $7,
            status = case when $8 = 'hidden' then 'hidden'::room_status else status end,
            updated_at = now()
          where id = $1::uuid and venue_id = $2::uuid
        `, [roomId, venueId, input.minimumHours, hourToClock(input.opensAtHour), hourToClock(input.closesAtHour), input.closesAtHour >= 24, input.bufferMinutes, input.status]);
      } else {
        await client.query(`/* rooms:update-partner-room-draft */
          update rooms set title = $3, room_type = $4, subtitle = $5, description = $6, rules = $7,
            promotion = nullif($8,''), capacity_min = $9, capacity_max = $10, price_per_hour = $11,
            minimum_hours = $12, opens_at = $13::time, closes_at = $14::time, closes_next_day = $15,
            buffer_minutes = $16, features = $17, tags = $18,
            status = case when $19 = 'hidden' then 'hidden'::room_status else 'review'::room_status end,
            updated_at = now()
          where id = $1::uuid and venue_id = $2::uuid
        `, [
          roomId, venueId, input.title.trim(), input.type.trim(), input.subtitle.trim(), input.description.trim(),
          input.rules.trim(), input.promotion.trim(), input.capacityMin, input.capacityMax, input.pricePerHour,
          input.minimumHours, hourToClock(input.opensAtHour), hourToClock(input.closesAtHour), input.closesAtHour >= 24,
          input.bufferMinutes, input.features, input.tags, input.status,
        ]);
        await this.replaceServices(client, roomId, services);
      }
      const moderationBefore = { ...before, ...(!published ? { publicationRequested: false } : {}) };
      const moderationAfter = {
        ...proposed,
        ...(!published && input.status !== "hidden" ? { publicationRequested: true } : {}),
      };
      await this.upsertModeration(client, { venueId: null, roomId }, actorId, moderationBefore, moderationAfter);
      await this.audit(client, actorId, "partner_room_updated", "room", roomId, before, {
        ...proposed, minimumHours: input.minimumHours, opensAtHour: input.opensAtHour,
        closesAtHour: input.closesAtHour, bufferMinutes: input.bufferMinutes, requestedStatus: input.status,
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return (await this.listRooms(venueId)).find((item) => item.id === roomId) ?? null;
  }

  async setScheduleException(
    venueId: string,
    actorId: string,
    date: string,
    input: PartnerScheduleExceptionWrite,
  ): Promise<PartnerVenueRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const venue = await client.query<{ exists: boolean }>("select exists(select 1 from venues where id = $1::uuid) as exists", [venueId]);
      if (!venue.rows[0]?.exists) {
        await client.query("rollback");
        return null;
      }
      await this.assertScheduleAvailable(client, venueId, date, input);
      const beforeResult = await client.query<ExceptionRow>(`select local_date, mode, opens_at::text, closes_at::text, closes_next_day, note
        from venue_schedule_exceptions where venue_id = $1::uuid and local_date = $2::date`, [venueId, date]);
      await client.query(`/* rooms:upsert-partner-schedule-exception */
        insert into venue_schedule_exceptions (venue_id, local_date, mode, opens_at, closes_at, closes_next_day, note)
        values ($1::uuid,$2::date,$3,$4::time,$5::time,$6,$7)
        on conflict (venue_id, local_date) do update set mode = excluded.mode, opens_at = excluded.opens_at,
          closes_at = excluded.closes_at, closes_next_day = excluded.closes_next_day, note = excluded.note
      `, [
        venueId, date, input.mode, input.mode === "custom" ? hourToClock(input.opensAtHour ?? 0) : null,
        input.mode === "custom" ? hourToClock(input.closesAtHour ?? 0) : null,
        input.mode === "custom" && numeric(input.closesAtHour) >= 24, input.note.trim(),
      ]);
      await this.audit(client, actorId, "partner_schedule_exception_set", "venue_schedule_exception", `${venueId}:${date}`,
        beforeResult.rows[0] ? { ...beforeResult.rows[0] } : {}, { date, ...input });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return this.getVenue(venueId);
  }

  async deleteScheduleException(venueId: string, actorId: string, date: string): Promise<PartnerVenueRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const venue = await client.query<{ exists: boolean }>("select exists(select 1 from venues where id = $1::uuid) as exists", [venueId]);
      if (!venue.rows[0]?.exists) {
        await client.query("rollback");
        return null;
      }
      const removed = await client.query<ExceptionRow>(`/* rooms:delete-partner-schedule-exception */
        delete from venue_schedule_exceptions where venue_id = $1::uuid and local_date = $2::date
        returning local_date, mode, opens_at::text, closes_at::text, closes_next_day, note
      `, [venueId, date]);
      await this.audit(client, actorId, "partner_schedule_exception_deleted", "venue_schedule_exception", `${venueId}:${date}`,
        removed.rows[0] ? { ...removed.rows[0] } : {}, {});
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return this.getVenue(venueId);
  }

  async listModeration(query: AdminModerationQuery): Promise<AdminModerationRecord[]> {
    const result = await this.pool.query<AdminModerationRow>(`/* rooms:admin-moderation-list */
      select m.id::text, m.venue_id::text, m.room_id::text, m.fields, m.before_data, m.proposed_data,
        m.status::text, m.submitted_by::text, submitter.name as submitted_by_name,
        submitter.email::text as submitted_by_email, m.reviewed_by::text, m.review_comment,
        m.reviewed_at, m.created_at,
        case when m.room_id is null then 'venue' else 'room' end as target_type,
        coalesce(m.venue_id, m.room_id)::text as target_id,
        coalesce(venue.title, room.title) as target_title,
        coalesce(venue.id, room_venue.id)::text as target_venue_id,
        coalesce(venue.title, room_venue.title) as venue_title
      from moderation_requests m
      left join venues venue on venue.id = m.venue_id
      left join rooms room on room.id = m.room_id
      left join venues room_venue on room_venue.id = room.venue_id
      left join users submitter on submitter.id = m.submitted_by
      where ($1 = 'all' or m.status::text = $1)
        and ($3::uuid is null or coalesce(m.venue_id, room.venue_id) = $3::uuid)
      order by (m.status = 'pending') desc, m.created_at desc
      limit $2
    `, [query.status, query.limit, query.venueId ?? null]);
    return result.rows.map(adminModerationFromRow);
  }

  async decideModeration(
    moderationId: string,
    actorId: string,
    decision: Exclude<ModerationStatus, "pending">,
    comment: string,
  ): Promise<AdminModerationRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query<AdminModerationRow>(`/* rooms:lock-admin-moderation */
        select m.id::text, m.venue_id::text, m.room_id::text, m.fields, m.before_data, m.proposed_data,
          m.status::text, m.submitted_by::text, submitter.name as submitted_by_name,
          submitter.email::text as submitted_by_email, m.reviewed_by::text, m.review_comment,
          m.reviewed_at, m.created_at,
          case when m.room_id is null then 'venue' else 'room' end as target_type,
          coalesce(m.venue_id, m.room_id)::text as target_id,
          coalesce(venue.title, room.title) as target_title,
          coalesce(venue.id, room_venue.id)::text as target_venue_id,
          coalesce(venue.title, room_venue.title) as venue_title
        from moderation_requests m
        left join venues venue on venue.id = m.venue_id
        left join rooms room on room.id = m.room_id
        left join venues room_venue on room_venue.id = room.venue_id
        left join users submitter on submitter.id = m.submitted_by
        where m.id = $1::uuid
        for update of m
      `, [moderationId]);
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("rollback");
        return null;
      }
      if (current.status !== "pending") {
        throw new PartnerCatalogError("MODERATION_ALREADY_REVIEWED", "Это изменение уже обработано другим администратором.");
      }
      if (current.target_type === "venue" && decision === "approved") {
        const data = current.proposed_data;
        await client.query(`/* rooms:approve-venue-moderation */
          update venues set title = $2, city = $3, address = $4, venue_type = nullif($5,''),
            description = $6, rules = $7, amenities = $8, payment_methods = $9,
            updated_at = now()
          where id = $1::uuid
        `, [
          current.target_id, textValue(data.title), textValue(data.city), textValue(data.address),
          textValue(data.venueType), textValue(data.description), textValue(data.rules),
          stringArray(data.amenities), paymentMethodsValue(data.paymentMethods),
        ]);
      }
      if (current.target_type === "room") {
        const publicationRequested = current.proposed_data.publicationRequested === true;
        if (decision === "approved") {
          await this.applyRoomModerationSnapshot(client, current.target_id, current.proposed_data);
          if (publicationRequested) {
            await client.query("update rooms set status = 'published', updated_at = now() where id = $1::uuid", [current.target_id]);
          }
        } else {
          await this.applyRoomModerationSnapshot(client, current.target_id, current.before_data);
          if (publicationRequested) {
            await client.query("update rooms set status = case when status = 'published' then status else 'hidden' end, updated_at = now() where id = $1::uuid", [current.target_id]);
          }
        }
      }
      await client.query(`/* rooms:complete-admin-moderation */
        update moderation_requests set status = $2::moderation_status, reviewed_by = $3::uuid,
          review_comment = nullif($4,''), reviewed_at = now()
        where id = $1::uuid
      `, [moderationId, decision, actorId, comment.trim()]);
      await client.query(`insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data)
        values ($1::uuid,'admin',$2,'moderation_request',$3,$4::jsonb,$5::jsonb)
      `, [
        actorId,
        decision === "approved" ? "moderation_approved" : "moderation_rejected",
        moderationId,
        JSON.stringify({ status: "pending", targetType: current.target_type, targetId: current.target_id }),
        JSON.stringify({ status: decision, comment: comment.trim() || null }),
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return this.moderationById(moderationId);
  }

  private async moderationById(moderationId: string): Promise<AdminModerationRecord | null> {
    const result = await this.pool.query<AdminModerationRow>(`/* rooms:admin-moderation-by-id */
      select m.id::text, m.venue_id::text, m.room_id::text, m.fields, m.before_data, m.proposed_data,
        m.status::text, m.submitted_by::text, submitter.name as submitted_by_name,
        submitter.email::text as submitted_by_email, m.reviewed_by::text, m.review_comment,
        m.reviewed_at, m.created_at,
        case when m.room_id is null then 'venue' else 'room' end as target_type,
        coalesce(m.venue_id, m.room_id)::text as target_id,
        coalesce(venue.title, room.title) as target_title,
        coalesce(venue.id, room_venue.id)::text as target_venue_id,
        coalesce(venue.title, room_venue.title) as venue_title
      from moderation_requests m
      left join venues venue on venue.id = m.venue_id
      left join rooms room on room.id = m.room_id
      left join venues room_venue on room_venue.id = room.venue_id
      left join users submitter on submitter.id = m.submitted_by
      where m.id = $1::uuid
    `, [moderationId]);
    return result.rows[0] ? adminModerationFromRow(result.rows[0]) : null;
  }

  private async applyRoomModerationSnapshot(
    client: PoolClient,
    roomId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (typeof data.title !== "string") return;
    const services = servicesValue(data.services);
    await client.query(`/* rooms:apply-room-moderation */
      update rooms set title = $2, subtitle = $3, room_type = $4, description = $5, rules = $6,
        promotion = nullif($7,''), capacity_min = $8, capacity_max = $9, price_per_hour = $10,
        features = $11, tags = $12, updated_at = now()
      where id = $1::uuid
    `, [
      roomId, textValue(data.title), textValue(data.subtitle), textValue(data.type),
      textValue(data.description), textValue(data.rules), textValue(data.promotion),
      numberValue(data.capacityMin), numberValue(data.capacityMax), numberValue(data.pricePerHour),
      stringArray(data.features), stringArray(data.tags),
    ]);
    await this.replaceServices(client, roomId, services);
  }

  private roomFromRow(
    row: RoomDetailsRow,
    photoPaths: string[],
    services: RoomService[],
    pendingChange: PartnerModerationChange | null,
  ): PartnerRoomRecord {
    return {
      id: row.id,
      slug: row.slug,
      venueId: row.venue_id,
      title: row.title,
      subtitle: row.subtitle ?? "",
      type: row.room_type,
      capacityMin: numeric(row.capacity_min),
      capacityMax: numeric(row.capacity_max),
      pricePerHour: numeric(row.price_per_hour),
      minimumHours: numeric(row.minimum_hours),
      rating: numeric(row.rating_cached),
      reviewCount: numeric(row.review_count_cached),
      description: row.description ?? "",
      rules: row.rules ?? "",
      promotion: row.promotion,
      features: row.features ?? [],
      tags: row.tags ?? [],
      photoPaths,
      services,
      opensAtHour: clockHour(row.opens_at),
      closesAtHour: clockHour(row.closes_at, row.closes_next_day),
      bufferMinutes: row.buffer_minutes,
      defaultBlocked: [],
      blockedByDate: {},
      publicationStatus: row.publication_status,
      pendingChange,
    };
  }

  private async replaceWeekSchedule(client: PoolClient, venueId: string, schedule: PartnerWeekScheduleDay[]): Promise<void> {
    for (const day of schedule) {
      await client.query(`/* rooms:upsert-partner-week-schedule */
        insert into venue_week_schedule (venue_id, weekday, enabled, opens_at, closes_at, closes_next_day)
        values ($1::uuid,$2,$3,$4::time,$5::time,$6)
        on conflict (venue_id, weekday) do update set enabled = excluded.enabled, opens_at = excluded.opens_at,
          closes_at = excluded.closes_at, closes_next_day = excluded.closes_next_day
      `, [
        venueId, day.weekday, day.enabled, day.enabled ? hourToClock(day.opensAtHour) : null,
        day.enabled ? hourToClock(day.closesAtHour) : null, day.enabled && day.closesAtHour >= 24,
      ]);
    }
  }

  private async replaceServices(client: PoolClient, roomId: string, services: RoomService[]): Promise<void> {
    await client.query("delete from room_services where room_id = $1::uuid", [roomId]);
    for (const [index, service] of services.entries()) {
      await client.query(`insert into room_services (id, room_id, name, description, price, pricing_unit, active, sort_order)
        values ($1::uuid,$2::uuid,$3,$4,$5,'booking',true,$6)`,
      [service.id, roomId, service.name, service.description, service.price, index]);
    }
  }

  private async loadServices(client: PoolClient, roomId: string): Promise<RoomService[]> {
    const result = await client.query<ServiceRow>(`select room_id::text, id::text, name, description, price::float8
      from room_services where room_id = $1::uuid and active order by sort_order, name`, [roomId]);
    return result.rows.map((service) => ({
      id: service.id, name: service.name, description: service.description, price: numeric(service.price),
    }));
  }

  private async upsertModeration(
    client: PoolClient,
    target: { venueId: string | null; roomId: string | null },
    actorId: string,
    beforeData: Record<string, unknown>,
    proposedData: Record<string, unknown>,
  ): Promise<void> {
    const targetColumn = target.roomId ? "room_id" : "venue_id";
    const targetId = target.roomId ?? target.venueId;
    if (!targetId) throw new Error("Moderation target is required.");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${targetColumn}:${targetId}`]);
    const existing = await client.query<ModerationRow>(`select id::text, room_id::text, fields, before_data, proposed_data, created_at
      from moderation_requests where ${targetColumn} = $1::uuid and status = 'pending'
      order by created_at desc limit 1 for update`, [targetId]);
    const current = existing.rows[0];
    const original = current?.before_data ? cloneObject(current.before_data) : cloneObject(beforeData);
    const proposed = { ...(current?.proposed_data ? cloneObject(current.proposed_data) : {}), ...cloneObject(proposedData) };
    const fields = changedFields(original, proposed);
    if (!fields.length) {
      if (current) await client.query("delete from moderation_requests where id = $1::uuid", [current.id]);
      return;
    }
    if (current) {
      await client.query(`update moderation_requests set submitted_by = $2::uuid, fields = $3, before_data = $4::jsonb,
        proposed_data = $5::jsonb where id = $1::uuid`, [current.id, actorId, fields, JSON.stringify(original), JSON.stringify(proposed)]);
      return;
    }
    await client.query(`insert into moderation_requests (${targetColumn}, submitted_by, fields, before_data, proposed_data, status)
      values ($1::uuid,$2::uuid,$3,$4::jsonb,$5::jsonb,'pending')`,
    [targetId, actorId, fields, JSON.stringify(original), JSON.stringify(proposed)]);
  }

  private async assertScheduleAvailable(
    client: PoolClient,
    venueId: string,
    date: string,
    input: PartnerScheduleExceptionWrite,
  ): Promise<void> {
    const result = await client.query<{ conflict: boolean }>(`/* rooms:check-partner-schedule-exception */
      select exists(
        select 1 from room_reservations reservation
        join rooms room on room.id = reservation.room_id
        where room.venue_id = $1::uuid
          and reservation.active
          and (reservation.expires_at is null or reservation.expires_at > now())
          and (lower(reservation.period) at time zone 'Europe/Moscow')::date = $2::date
          and (
            $3 = 'closed'
            or lower(reservation.period) < (($2::date::timestamp + make_interval(secs => $4 * 3600)) at time zone 'Europe/Moscow')
            or upper(reservation.period) > (($2::date::timestamp + make_interval(secs => $5 * 3600)) at time zone 'Europe/Moscow')
          )
      ) as conflict
    `, [venueId, date, input.mode, input.opensAtHour ?? 0, input.closesAtHour ?? 0]);
    if (result.rows[0]?.conflict) {
      throw new PartnerCatalogError("SCHEDULE_HAS_RESERVATIONS", "Новый график пересекается с активной бронью. Сначала перенесите или отмените её.");
    }
  }

  private async audit(
    client: PoolClient,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    beforeData: Record<string, unknown>,
    afterData: Record<string, unknown>,
  ): Promise<void> {
    await client.query(`insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data)
      values ($1::uuid,'partner',$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [actorId, action, entityType, entityId, JSON.stringify(beforeData), JSON.stringify(afterData)]);
  }
}
