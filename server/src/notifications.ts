import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import type { Pool, QueryResultRow } from "pg";

export type NotificationChannel = "email" | "telegram";
export type NotificationDeliveryStatus = "queued" | "processing" | "sent" | "failed" | "cancelled";

export interface NotificationIdentity {
  id: string;
  name: string;
  email: string | null;
}

export interface NotificationSettings {
  siteEnabled: true;
  emailEnabled: boolean;
  emailAddress: string | null;
  telegramEnabled: boolean;
  telegramChatId: string | null;
}

export interface NotificationSettingsInput {
  emailEnabled: boolean;
  emailAddress: string | null;
  telegramEnabled: boolean;
  telegramChatId: string | null;
}

export interface NotificationRecipient extends NotificationIdentity {
  settings: NotificationSettings;
}

export interface BookingNotificationRecipients {
  clientUserId: string;
  venueId: string;
}

export interface NotificationDeliveryRecord {
  id: string;
  userId: string | null;
  venueId: string | null;
  channel: NotificationChannel;
  target: string;
  eventKey: string;
  dedupeKey: string;
  title: string;
  body: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  processingStartedAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicNotificationDelivery {
  id: string;
  userId: string | null;
  venueId: string | null;
  channel: NotificationChannel;
  target: string;
  eventKey: string;
  title: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface NotificationDeliveryQuery {
  status?: NotificationDeliveryStatus;
  channel?: NotificationChannel;
  limit?: number;
}

export interface NotificationQueueInput {
  id: string;
  userId: string | null;
  venueId: string | null;
  channel: NotificationChannel;
  target: string;
  eventKey: string;
  dedupeKey: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface NotificationRepository {
  readonly storage: "memory" | "postgresql";
  rememberUser(user: NotificationIdentity): Promise<void>;
  rememberVenueRecipient(venueId: string, user: NotificationIdentity): Promise<void>;
  rememberBookingRecipients(bookingId: string, clientUserId: string, venueId: string): Promise<void>;
  getSettings(user: NotificationIdentity): Promise<NotificationSettings>;
  updateSettings(user: NotificationIdentity, input: NotificationSettingsInput): Promise<NotificationSettings>;
  findUserRecipient(userId: string): Promise<NotificationRecipient | null>;
  findVenueRecipients(venueId: string): Promise<NotificationRecipient[]>;
  findBookingRecipients(bookingId: string): Promise<BookingNotificationRecipients | null>;
  enqueue(input: NotificationQueueInput): Promise<NotificationDeliveryRecord | null>;
  listForUser(userId: string, query?: NotificationDeliveryQuery): Promise<NotificationDeliveryRecord[]>;
  listAll(query?: NotificationDeliveryQuery): Promise<NotificationDeliveryRecord[]>;
  claimBatch(limit: number): Promise<NotificationDeliveryRecord[]>;
  markSent(id: string, providerMessageId: string | null): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt: string | null): Promise<void>;
}

function defaultSettings(email: string | null): NotificationSettings {
  return {
    siteEnabled: true,
    emailEnabled: Boolean(email),
    emailAddress: email,
    telegramEnabled: false,
    telegramChatId: null,
  };
}

function cloneSettings(settings: NotificationSettings): NotificationSettings {
  return structuredClone(settings);
}

export class MemoryNotificationRepository implements NotificationRepository {
  readonly storage = "memory" as const;
  private readonly users = new Map<string, NotificationIdentity>();
  private readonly settings = new Map<string, NotificationSettings>();
  private readonly venueRecipients = new Map<string, Set<string>>();
  private readonly bookingRecipients = new Map<string, BookingNotificationRecipients>();
  private readonly deliveries = new Map<string, NotificationDeliveryRecord>();

  async rememberUser(user: NotificationIdentity): Promise<void> {
    this.users.set(user.id, structuredClone(user));
  }

  async rememberVenueRecipient(venueId: string, user: NotificationIdentity): Promise<void> {
    await this.rememberUser(user);
    const recipients = this.venueRecipients.get(venueId) ?? new Set<string>();
    recipients.add(user.id);
    this.venueRecipients.set(venueId, recipients);
  }

  async rememberBookingRecipients(bookingId: string, clientUserId: string, venueId: string): Promise<void> {
    this.bookingRecipients.set(bookingId, { clientUserId, venueId });
  }

  async getSettings(user: NotificationIdentity): Promise<NotificationSettings> {
    await this.rememberUser(user);
    return cloneSettings(this.settings.get(user.id) ?? defaultSettings(user.email));
  }

  async updateSettings(user: NotificationIdentity, input: NotificationSettingsInput): Promise<NotificationSettings> {
    await this.rememberUser(user);
    const settings: NotificationSettings = { siteEnabled: true, ...input };
    this.settings.set(user.id, settings);
    return cloneSettings(settings);
  }

  async findUserRecipient(userId: string): Promise<NotificationRecipient | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    return { ...structuredClone(user), settings: cloneSettings(this.settings.get(userId) ?? defaultSettings(user.email)) };
  }

  async findVenueRecipients(venueId: string): Promise<NotificationRecipient[]> {
    const recipients = this.venueRecipients.get(venueId) ?? new Set<string>();
    return (await Promise.all([...recipients].map((userId) => this.findUserRecipient(userId))))
      .filter((recipient): recipient is NotificationRecipient => recipient !== null);
  }

  async findBookingRecipients(bookingId: string): Promise<BookingNotificationRecipients | null> {
    const found = this.bookingRecipients.get(bookingId);
    return found ? structuredClone(found) : null;
  }

  async enqueue(input: NotificationQueueInput): Promise<NotificationDeliveryRecord | null> {
    if ([...this.deliveries.values()].some((delivery) => delivery.dedupeKey === input.dedupeKey)) return null;
    const delivery: NotificationDeliveryRecord = {
      ...structuredClone(input),
      status: "queued",
      attempts: 0,
      nextAttemptAt: null,
      processingStartedAt: null,
      sentAt: null,
      lastError: null,
      providerMessageId: null,
      updatedAt: input.createdAt,
    };
    this.deliveries.set(delivery.id, delivery);
    return structuredClone(delivery);
  }

  async listForUser(userId: string, query: NotificationDeliveryQuery = {}): Promise<NotificationDeliveryRecord[]> {
    return this.filterDeliveries({ ...query, userId });
  }

  async listAll(query: NotificationDeliveryQuery = {}): Promise<NotificationDeliveryRecord[]> {
    return this.filterDeliveries(query);
  }

  async claimBatch(limit: number): Promise<NotificationDeliveryRecord[]> {
    const now = Date.now();
    const staleBefore = now - 10 * 60 * 1000;
    for (const [id, delivery] of this.deliveries) {
      if (delivery.status === "processing" && new Date(delivery.processingStartedAt ?? 0).getTime() <= staleBefore) {
        this.deliveries.set(id, { ...delivery, status: "queued", processingStartedAt: null });
      }
    }
    const claimed = [...this.deliveries.values()]
      .filter((delivery) => (
        delivery.status === "queued"
        || (delivery.status === "failed" && delivery.attempts < 5 && new Date(delivery.nextAttemptAt ?? 0).getTime() <= now)
      ))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
    const processingAt = new Date().toISOString();
    return claimed.map((delivery) => {
      const updated = { ...delivery, status: "processing" as const, attempts: delivery.attempts + 1, processingStartedAt: processingAt, updatedAt: processingAt };
      this.deliveries.set(delivery.id, updated);
      return structuredClone(updated);
    });
  }

  async markSent(id: string, providerMessageId: string | null): Promise<void> {
    const delivery = this.deliveries.get(id);
    if (!delivery) return;
    const now = new Date().toISOString();
    this.deliveries.set(id, { ...delivery, body: "purged:v1", status: "sent", sentAt: now, providerMessageId, processingStartedAt: null, nextAttemptAt: null, lastError: null, updatedAt: now });
  }

  async markFailed(id: string, error: string, nextAttemptAt: string | null): Promise<void> {
    const delivery = this.deliveries.get(id);
    if (!delivery) return;
    const now = new Date().toISOString();
    this.deliveries.set(id, { ...delivery, status: "failed", lastError: error, nextAttemptAt, processingStartedAt: null, updatedAt: now });
  }

  private filterDeliveries(query: NotificationDeliveryQuery & { userId?: string }): NotificationDeliveryRecord[] {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    return [...this.deliveries.values()]
      .filter((delivery) => (!query.userId || delivery.userId === query.userId)
        && (!query.status || delivery.status === query.status)
        && (!query.channel || delivery.channel === query.channel))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((delivery) => structuredClone(delivery));
  }
}

interface SettingsRow extends QueryResultRow {
  id: string;
  name: string;
  email: string | null;
  email_enabled: boolean | null;
  email_address: string | null;
  telegram_enabled: boolean | null;
  telegram_chat_id: string | null;
}

interface DeliveryRow extends QueryResultRow {
  id: string;
  user_id: string | null;
  venue_id: string | null;
  channel: NotificationChannel;
  target: string;
  event_key: string;
  dedupe_key: string;
  title: string;
  body: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  next_attempt_at: Date | string | null;
  processing_started_at: Date | string | null;
  sent_at: Date | string | null;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function settingsFromRow(row: SettingsRow): NotificationSettings {
  const fallback = row.email;
  return {
    siteEnabled: true,
    emailEnabled: row.email_enabled ?? Boolean(fallback),
    emailAddress: row.email_address ?? fallback,
    telegramEnabled: row.telegram_enabled ?? false,
    telegramChatId: row.telegram_chat_id,
  };
}

function recipientFromRow(row: SettingsRow): NotificationRecipient {
  return { id: row.id, name: row.name, email: row.email, settings: settingsFromRow(row) };
}

function deliveryFromRow(row: DeliveryRow): NotificationDeliveryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    venueId: row.venue_id,
    channel: row.channel,
    target: row.target,
    eventKey: row.event_key,
    dedupeKey: row.dedupe_key,
    title: row.title,
    body: row.body,
    status: row.status,
    attempts: Number(row.attempts) || 0,
    nextAttemptAt: iso(row.next_attempt_at),
    processingStartedAt: iso(row.processing_started_at),
    sentAt: iso(row.sent_at),
    lastError: row.last_error,
    providerMessageId: row.provider_message_id,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

const recipientSelect = `
  select u.id::text, u.name, u.email::text,
    p.email_enabled, p.email_address::text, p.telegram_enabled, p.telegram_chat_id
  from users u
  left join notification_preferences p on p.user_id = u.id
`;

const deliveryColumns = `
  id::text, user_id::text, venue_id::text, channel, target, event_key, dedupe_key,
  title, body, status, attempts, next_attempt_at, processing_started_at, sent_at,
  last_error, provider_message_id, created_at, updated_at
`;

const claimedDeliveryColumns = `
  delivery.id::text, delivery.user_id::text, delivery.venue_id::text, delivery.channel,
  delivery.target, delivery.event_key, delivery.dedupe_key, delivery.title, delivery.body,
  delivery.status, delivery.attempts, delivery.next_attempt_at, delivery.processing_started_at,
  delivery.sent_at, delivery.last_error, delivery.provider_message_id, delivery.created_at,
  delivery.updated_at
`;

export class PostgresNotificationRepository implements NotificationRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async rememberUser(_user: NotificationIdentity): Promise<void> {}
  async rememberVenueRecipient(_venueId: string, _user: NotificationIdentity): Promise<void> {}
  async rememberBookingRecipients(_bookingId: string, _clientUserId: string, _venueId: string): Promise<void> {}

  async getSettings(user: NotificationIdentity): Promise<NotificationSettings> {
    const result = await this.pool.query<SettingsRow>(`${recipientSelect} where u.id = $1::uuid and u.blocked_at is null limit 1`, [user.id]);
    return result.rows[0] ? settingsFromRow(result.rows[0]) : defaultSettings(user.email);
  }

  async updateSettings(user: NotificationIdentity, input: NotificationSettingsInput): Promise<NotificationSettings> {
    await this.pool.query(`/* rooms:update-notification-settings */
      insert into notification_preferences (
        user_id, site_enabled, email_enabled, email_address, telegram_enabled, telegram_chat_id, updated_at
      ) values ($1::uuid, true, $2, $3, $4, $5, now())
      on conflict (user_id) do update set
        site_enabled = true,
        email_enabled = excluded.email_enabled,
        email_address = excluded.email_address,
        telegram_enabled = excluded.telegram_enabled,
        telegram_chat_id = excluded.telegram_chat_id,
        updated_at = now()
    `, [user.id, input.emailEnabled, input.emailAddress, input.telegramEnabled, input.telegramChatId]);
    return { siteEnabled: true, ...input };
  }

  async findUserRecipient(userId: string): Promise<NotificationRecipient | null> {
    const result = await this.pool.query<SettingsRow>(`${recipientSelect} where u.id = $1::uuid and u.blocked_at is null limit 1`, [userId]);
    return result.rows[0] ? recipientFromRow(result.rows[0]) : null;
  }

  async findVenueRecipients(venueId: string): Promise<NotificationRecipient[]> {
    const result = await this.pool.query<SettingsRow>(`${recipientSelect}
      join venue_members member on member.user_id = u.id
      where member.venue_id = $1::uuid and u.blocked_at is null and u.role = 'partner'
      order by member.created_at
    `, [venueId]);
    return result.rows.map(recipientFromRow);
  }

  async findBookingRecipients(bookingId: string): Promise<BookingNotificationRecipients | null> {
    const result = await this.pool.query<{ client_user_id: string; venue_id: string }>(`
      select client_id::text as client_user_id, venue_id::text
      from bookings where id = $1::uuid limit 1
    `, [bookingId]);
    const row = result.rows[0];
    return row ? { clientUserId: row.client_user_id, venueId: row.venue_id } : null;
  }

  async enqueue(input: NotificationQueueInput): Promise<NotificationDeliveryRecord | null> {
    const result = await this.pool.query<DeliveryRow>(`/* rooms:enqueue-notification */
      insert into notification_deliveries (
        id, user_id, venue_id, channel, target, event_key, dedupe_key, title, body, created_at, updated_at
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::delivery_channel, $5, $6, $7, $8, $9, $10::timestamptz, $10::timestamptz)
      on conflict (dedupe_key) do nothing
      returning ${deliveryColumns}
    `, [input.id, input.userId, input.venueId, input.channel, input.target, input.eventKey, input.dedupeKey, input.title, input.body, input.createdAt]);
    return result.rows[0] ? deliveryFromRow(result.rows[0]) : null;
  }

  async listForUser(userId: string, query: NotificationDeliveryQuery = {}): Promise<NotificationDeliveryRecord[]> {
    return this.list({ ...query, userId });
  }

  async listAll(query: NotificationDeliveryQuery = {}): Promise<NotificationDeliveryRecord[]> {
    return this.list(query);
  }

  async claimBatch(limit: number): Promise<NotificationDeliveryRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`
        update notification_deliveries
        set status = 'queued', processing_started_at = null, updated_at = now()
        where status = 'processing' and processing_started_at < now() - interval '10 minutes'
      `);
      const result = await client.query<DeliveryRow>(`/* rooms:claim-notifications */
        with selected as (
          select id from notification_deliveries
          where (
            status = 'queued'
            or (status = 'failed' and attempts < 5 and next_attempt_at <= now())
          )
          order by created_at
          limit $1
          for update skip locked
        )
        update notification_deliveries delivery
        set status = 'processing', attempts = attempts + 1, processing_started_at = now(), updated_at = now()
        from selected
        where delivery.id = selected.id
        returning ${claimedDeliveryColumns.split("\n").join("\n        ")}
      `, [Math.min(Math.max(limit, 1), 100)]);
      await client.query("commit");
      return result.rows.map(deliveryFromRow);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markSent(id: string, providerMessageId: string | null): Promise<void> {
    await this.pool.query(`
      update notification_deliveries
      set body = 'purged:v1', status = 'sent', sent_at = now(), provider_message_id = $2,
        processing_started_at = null, next_attempt_at = null, last_error = null, updated_at = now()
      where id = $1::uuid and status = 'processing'
    `, [id, providerMessageId]);
  }

  async markFailed(id: string, error: string, nextAttemptAt: string | null): Promise<void> {
    await this.pool.query(`
      update notification_deliveries
      set status = 'failed', last_error = $2, next_attempt_at = $3::timestamptz,
        processing_started_at = null, updated_at = now()
      where id = $1::uuid and status = 'processing'
    `, [id, error, nextAttemptAt]);
  }

  private async list(query: NotificationDeliveryQuery & { userId?: string }): Promise<NotificationDeliveryRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.userId) { values.push(query.userId); conditions.push(`user_id = $${values.length}::uuid`); }
    if (query.status) { values.push(query.status); conditions.push(`status = $${values.length}::delivery_status`); }
    if (query.channel) { values.push(query.channel); conditions.push(`channel = $${values.length}::delivery_channel`); }
    values.push(Math.min(Math.max(query.limit ?? 50, 1), 200));
    const result = await this.pool.query<DeliveryRow>(`
      select ${deliveryColumns}
      from notification_deliveries
      ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
      order by created_at desc
      limit $${values.length}
    `, values);
    return result.rows.map(deliveryFromRow);
  }
}

export class NotificationCipher {
  private readonly key: Buffer;
  private readonly associatedData = Buffer.from("rooms-notification-v1", "utf8");

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("NOTIFICATION_ENCRYPTION_KEY must contain at least 32 bytes.");
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.associatedData);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  decrypt(value: string): string {
    const [prefix, version, ivValue, tagValue, encryptedValue] = value.split(":");
    if (prefix !== "enc" || version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Notification payload is unavailable.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAAD(this.associatedData);
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  }
}

export function maskNotificationTarget(channel: NotificationChannel, target: string): string {
  if (channel === "email") {
    const [local = "", domain = ""] = target.split("@");
    return domain ? `${local.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(local.length - 2, 6)))}@${domain}` : "скрытый email";
  }
  return target.startsWith("@") ? `${target.slice(0, 3)}***` : `${target.slice(0, 3)}***${target.slice(-2)}`;
}

export function publicNotificationDelivery(delivery: NotificationDeliveryRecord): PublicNotificationDelivery {
  return {
    id: delivery.id,
    userId: delivery.userId,
    venueId: delivery.venueId,
    channel: delivery.channel,
    target: maskNotificationTarget(delivery.channel, delivery.target),
    eventKey: delivery.eventKey,
    title: delivery.title,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt,
    sentAt: delivery.sentAt,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
  };
}

interface EnqueueEvent {
  eventKey: string;
  title: string;
  body: string;
  dedupeKey: string;
}

export class NotificationService {
  constructor(private readonly repository: NotificationRepository, private readonly cipher: NotificationCipher) {}

  rememberUser(user: NotificationIdentity): Promise<void> {
    return this.repository.rememberUser(user);
  }

  rememberVenueRecipient(venueId: string, user: NotificationIdentity): Promise<void> {
    return this.repository.rememberVenueRecipient(venueId, user);
  }

  rememberBookingRecipients(bookingId: string, clientUserId: string, venueId: string): Promise<void> {
    return this.repository.rememberBookingRecipients(bookingId, clientUserId, venueId);
  }

  getSettings(user: NotificationIdentity): Promise<NotificationSettings> {
    return this.repository.getSettings(user);
  }

  updateSettings(user: NotificationIdentity, input: NotificationSettingsInput): Promise<NotificationSettings> {
    return this.repository.updateSettings(user, input);
  }

  async enqueuePasswordReset(user: NotificationIdentity, resetUrl: string): Promise<PublicNotificationDelivery[]> {
    if (!user.email) return [];
    const event: EnqueueEvent = {
      eventKey: "password_reset_requested",
      title: "Смена пароля Rooms",
      body: `Здравствуйте, ${user.name}.\n\nЧтобы создать новый пароль, откройте ссылку в течение 15 минут:\n${resetUrl}\n\nЕсли вы не запрашивали смену пароля, просто проигнорируйте письмо.`,
      dedupeKey: `password-reset|${createHash("sha256").update(resetUrl).digest("hex")}`,
    };
    const delivery = await this.enqueueDirect(user, null, "email", user.email, event);
    return delivery ? [publicNotificationDelivery(delivery)] : [];
  }

  async enqueueUser(user: NotificationIdentity, event: EnqueueEvent): Promise<PublicNotificationDelivery[]> {
    await this.repository.rememberUser(user);
    const settings = await this.repository.getSettings(user);
    return this.enqueueRecipient({ ...user, settings }, null, event);
  }

  async enqueueBookingClient(bookingId: string, event: EnqueueEvent): Promise<PublicNotificationDelivery[]> {
    const recipients = await this.repository.findBookingRecipients(bookingId);
    if (!recipients) return [];
    const client = await this.repository.findUserRecipient(recipients.clientUserId);
    return client ? this.enqueueRecipient(client, recipients.venueId, event) : [];
  }

  async enqueueBookingVenue(bookingId: string, event: EnqueueEvent): Promise<PublicNotificationDelivery[]> {
    const recipients = await this.repository.findBookingRecipients(bookingId);
    return recipients ? this.enqueueVenue(recipients.venueId, event) : [];
  }

  async enqueueVenue(venueId: string, event: EnqueueEvent): Promise<PublicNotificationDelivery[]> {
    const recipients = await this.repository.findVenueRecipients(venueId);
    const deliveries = await Promise.all(recipients.map((recipient) => this.enqueueRecipient(recipient, venueId, event)));
    return deliveries.flat();
  }

  async enqueueTest(user: NotificationIdentity, dedupeKey: string): Promise<PublicNotificationDelivery[]> {
    return this.enqueueUser(user, {
      eventKey: "notification_test",
      title: "Тестовое уведомление Rooms",
      body: "Канал работает: Rooms сможет присылать сюда важные статусы заявок и оплат.",
      dedupeKey,
    });
  }

  async listForUser(userId: string, query: NotificationDeliveryQuery = {}): Promise<PublicNotificationDelivery[]> {
    return (await this.repository.listForUser(userId, query)).map(publicNotificationDelivery);
  }

  async listAll(query: NotificationDeliveryQuery = {}): Promise<PublicNotificationDelivery[]> {
    return (await this.repository.listAll(query)).map(publicNotificationDelivery);
  }

  private async enqueueRecipient(recipient: NotificationRecipient, venueId: string | null, event: EnqueueEvent): Promise<PublicNotificationDelivery[]> {
    const channels: Array<[NotificationChannel, string]> = [];
    if (recipient.settings.emailEnabled && recipient.settings.emailAddress) channels.push(["email", recipient.settings.emailAddress]);
    if (recipient.settings.telegramEnabled && recipient.settings.telegramChatId) channels.push(["telegram", recipient.settings.telegramChatId]);
    const deliveries = await Promise.all(channels.map(([channel, target]) => this.enqueueDirect(recipient, venueId, channel, target, event)));
    return deliveries.filter((delivery): delivery is NotificationDeliveryRecord => delivery !== null).map(publicNotificationDelivery);
  }

  private enqueueDirect(recipient: NotificationIdentity, venueId: string | null, channel: NotificationChannel, target: string, event: EnqueueEvent): Promise<NotificationDeliveryRecord | null> {
    const createdAt = new Date().toISOString();
    return this.repository.enqueue({
      id: randomUUID(),
      userId: recipient.id,
      venueId,
      channel,
      target,
      eventKey: event.eventKey,
      dedupeKey: `${recipient.id}|${channel}|${event.dedupeKey}`,
      title: event.title,
      body: this.cipher.encrypt(event.body),
      createdAt,
    });
  }
}

export interface NotificationProviderConfig {
  mode: "log" | "live";
  smtpUrl: string;
  emailFrom: string;
  telegramBotToken: string;
}

export function notificationProviderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationProviderConfig {
  const defaultMode = env.NODE_ENV === "production" ? "live" : "log";
  const mode = String(env.NOTIFICATION_DELIVERY_MODE || defaultMode).trim().toLowerCase();
  if (mode !== "log" && mode !== "live") throw new Error("NOTIFICATION_DELIVERY_MODE must be log or live.");
  return {
    mode,
    smtpUrl: String(env.SMTP_URL || "").trim(),
    emailFrom: String(env.EMAIL_FROM || "").trim(),
    telegramBotToken: String(env.TELEGRAM_BOT_TOKEN || "").trim(),
  };
}

export interface DeliveryMessage {
  id: string;
  channel: NotificationChannel;
  target: string;
  title: string;
  body: string;
}

export class NotificationDispatcher {
  private transporter: Transporter | null = null;

  constructor(private readonly config: NotificationProviderConfig, private readonly log: (message: string) => void = console.info) {}

  async send(message: DeliveryMessage): Promise<string | null> {
    if (this.config.mode === "log") {
      this.log(`Rooms notification ${message.id}: ${message.channel} -> ${maskNotificationTarget(message.channel, message.target)} (${message.title})`);
      return `log:${message.id}`;
    }
    return message.channel === "email" ? this.sendEmail(message) : this.sendTelegram(message);
  }

  private async sendEmail(message: DeliveryMessage): Promise<string | null> {
    if (!this.config.smtpUrl || !this.config.emailFrom) throw new Error("SMTP delivery is not configured.");
    this.transporter ??= createTransport(this.config.smtpUrl);
    const result = await this.transporter.sendMail({
      from: this.config.emailFrom,
      to: message.target,
      subject: message.title,
      text: message.body,
    });
    return result.messageId || null;
  }

  private async sendTelegram(message: DeliveryMessage): Promise<string | null> {
    if (!this.config.telegramBotToken) throw new Error("Telegram delivery is not configured.");
    const response = await fetch(`https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: message.target, text: `${message.title}\n\n${message.body}`.slice(0, 4096) }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    if (!response.ok || !payload?.ok) throw new Error(`Telegram delivery failed (${response.status}): ${String(payload?.description || "unknown error").slice(0, 200)}`);
    return payload.result?.message_id ? String(payload.result.message_id) : null;
  }
}

export interface NotificationWorkerSummary {
  claimed: number;
  sent: number;
  failed: number;
}

export async function processNotificationBatch(
  repository: NotificationRepository,
  cipher: NotificationCipher,
  dispatcher: NotificationDispatcher,
  limit = 20,
): Promise<NotificationWorkerSummary> {
  const deliveries = await repository.claimBatch(limit);
  const summary: NotificationWorkerSummary = { claimed: deliveries.length, sent: 0, failed: 0 };
  for (const delivery of deliveries) {
    try {
      const body = cipher.decrypt(delivery.body);
      const providerMessageId = await dispatcher.send({ id: delivery.id, channel: delivery.channel, target: delivery.target, title: delivery.title, body });
      await repository.markSent(delivery.id, providerMessageId);
      summary.sent += 1;
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).replace(/bot[A-Za-z0-9:_-]{20,}/gu, "bot[redacted]").slice(0, 500);
      const delaySeconds = Math.min(6 * 60 * 60, 60 * 5 ** Math.max(0, delivery.attempts - 1));
      const nextAttemptAt = delivery.attempts >= 5 ? null : new Date(Date.now() + delaySeconds * 1000).toISOString();
      await repository.markFailed(delivery.id, message, nextAttemptAt);
      summary.failed += 1;
    }
  }
  return summary;
}

export function startNotificationWorker(
  repository: NotificationRepository,
  cipher: NotificationCipher,
  dispatcher: NotificationDispatcher,
  intervalMs = 5_000,
  onError: (error: unknown) => void = console.error,
): { stop(): void; runNow(): Promise<NotificationWorkerSummary> } {
  let active = false;
  let stopped = false;
  const runNow = async () => {
    if (active || stopped) return { claimed: 0, sent: 0, failed: 0 };
    active = true;
    try {
      return await processNotificationBatch(repository, cipher, dispatcher);
    } finally {
      active = false;
    }
  };
  const runSafely = () => void runNow().catch(onError);
  const timer = setInterval(runSafely, Math.max(intervalMs, 1_000));
  timer.unref();
  runSafely();
  return { stop: () => { stopped = true; clearInterval(timer); }, runNow };
}
