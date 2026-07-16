import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import { MemoryBookingRepository } from "./bookings.js";

export type PaymentStatus = "pending" | "paid" | "failed";

export interface PaymentRecord {
  paymentId: string;
  bookingId: string;
  status: PaymentStatus;
  provider: "rooms_demo";
  providerPaymentId: string;
  amount: number;
  currency: "RUB";
  redirectUrl: string;
  expiresAt: string;
  maskedCard: string | null;
  receiptNumber: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentRepository {
  readonly storage: "memory" | "postgresql";
  createIntent(clientId: string, bookingId: string): Promise<PaymentRecord>;
  completeDemo(clientId: string, paymentId: string): Promise<PaymentRecord>;
}

export class PaymentActionError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

interface MemoryPayment extends PaymentRecord {
  clientId: string;
}

function demoRedirect(paymentId: string): string {
  return `rooms-demo://payment/${paymentId}`;
}

function receiptNumber(): string {
  return `RCP-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function paymentUnavailable(status: string): never {
  if (status === "expired") {
    throw new PaymentActionError(409, "PAYMENT_HOLD_EXPIRED", "Время на предоплату истекло. Слот снова доступен для бронирования.");
  }
  throw new PaymentActionError(409, "PAYMENT_UNAVAILABLE", "Эта заявка сейчас не готова к предоплате.");
}

export class MemoryPaymentRepository implements PaymentRepository {
  readonly storage = "memory" as const;
  private readonly payments = new Map<string, MemoryPayment>();

  constructor(private readonly bookings: MemoryBookingRepository) {}

  async createIntent(clientId: string, bookingId: string): Promise<PaymentRecord> {
    const booking = this.bookings.paymentBooking(clientId, bookingId);
    if (!booking) throw new PaymentActionError(404, "BOOKING_NOT_FOUND", "Бронь не найдена в вашем кабинете.");
    const existing = [...this.payments.values()].find((payment) => payment.bookingId === bookingId && payment.clientId === clientId);
    if (booking.status === "paid" && existing?.status === "paid") return structuredClone(existing);
    if (booking.status !== "awaiting_payment" || !booking.paymentHoldExpiresAt) paymentUnavailable(booking.status);
    if (existing?.status === "pending") return structuredClone(existing);
    const paymentId = randomUUID();
    const payment: MemoryPayment = {
      paymentId,
      bookingId,
      clientId,
      status: "pending",
      provider: "rooms_demo",
      providerPaymentId: `ROOMS-DEMO-${randomUUID()}`,
      amount: booking.money.prepayment,
      currency: "RUB",
      redirectUrl: demoRedirect(paymentId),
      expiresAt: booking.paymentHoldExpiresAt,
      maskedCard: null,
      receiptNumber: null,
      createdAt: new Date().toISOString(),
      paidAt: null,
    };
    this.payments.set(payment.paymentId, payment);
    return structuredClone(payment);
  }

  async completeDemo(clientId: string, paymentId: string): Promise<PaymentRecord> {
    const payment = this.payments.get(paymentId);
    if (!payment || payment.clientId !== clientId) throw new PaymentActionError(404, "PAYMENT_NOT_FOUND", "Платёж не найден в вашем кабинете.");
    const booking = this.bookings.paymentBooking(clientId, payment.bookingId);
    if (!booking) throw new PaymentActionError(404, "BOOKING_NOT_FOUND", "Бронь не найдена в вашем кабинете.");
    if (payment.status === "paid" && booking.status === "paid") return structuredClone(payment);
    if (booking.status !== "awaiting_payment" || !booking.paymentHoldExpiresAt) paymentUnavailable(booking.status);
    const completed = this.bookings.completePayment(clientId, booking.id);
    if (!completed || completed.status !== "paid") paymentUnavailable(completed?.status ?? booking.status);
    payment.status = "paid";
    payment.maskedCard = "•••• 4242";
    payment.receiptNumber = receiptNumber();
    payment.paidAt = new Date().toISOString();
    return structuredClone(payment);
  }
}

interface PaymentRow extends QueryResultRow {
  id: string;
  booking_id: string;
  status: PaymentStatus;
  provider: "rooms_demo";
  provider_payment_id: string;
  amount: string | number;
  currency: string;
  masked_card: string | null;
  receipt_number: string | null;
  created_at: Date | string;
  paid_at: Date | string | null;
}

interface PaymentBookingRow extends QueryResultRow {
  id: string;
  status: string;
  prepayment: string | number;
  payment_hold_expires_at: Date | string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function number(value: string | number): number {
  return Number(Number(value).toFixed(2));
}

function fromRow(row: PaymentRow, expiresAt: Date | string): PaymentRecord {
  return {
    paymentId: row.id,
    bookingId: row.booking_id,
    status: row.status,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    amount: number(row.amount),
    currency: "RUB",
    redirectUrl: demoRedirect(row.id),
    expiresAt: iso(expiresAt),
    maskedCard: row.masked_card,
    receiptNumber: row.receipt_number,
    createdAt: iso(row.created_at),
    paidAt: row.paid_at === null ? null : iso(row.paid_at),
  };
}

export class PostgresPaymentRepository implements PaymentRepository {
  readonly storage = "postgresql" as const;

  constructor(private readonly pool: Pool) {}

  async createIntent(clientId: string, bookingId: string): Promise<PaymentRecord> {
    await this.releaseExpired();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const bookingResult = await client.query<PaymentBookingRow>(`
        select id::text, status, prepayment, payment_hold_expires_at
        from bookings
        where id = $1::uuid and client_id = $2::uuid
        for update
      `, [bookingId, clientId]);
      const booking = bookingResult.rows[0];
      if (!booking) throw new PaymentActionError(404, "BOOKING_NOT_FOUND", "Бронь не найдена в вашем кабинете.");
      const existingResult = await client.query<PaymentRow>(`
        select id::text, booking_id::text, status, provider, provider_payment_id, amount, currency,
          masked_card, receipt_number, created_at, paid_at
        from payment_transactions
        where booking_id = $1::uuid and provider = 'rooms_demo'
        order by created_at desc
        limit 1
      `, [bookingId]);
      const existing = existingResult.rows[0];
      if (booking.status === "paid" && existing?.status === "paid") {
        await client.query("commit");
        return fromRow(existing, existing.paid_at ?? existing.created_at);
      }
      if (booking.status !== "awaiting_payment" || !booking.payment_hold_expires_at) paymentUnavailable(booking.status);
      if (new Date(booking.payment_hold_expires_at).getTime() <= Date.now()) paymentUnavailable("expired");
      if (existing?.status === "pending") {
        await client.query("commit");
        return fromRow(existing, booking.payment_hold_expires_at);
      }
      const paymentId = randomUUID();
      const inserted = await client.query<PaymentRow>(`
        insert into payment_transactions (
          id, booking_id, provider, provider_payment_id, idempotency_key, status, amount, currency, provider_payload
        ) values (
          $1::uuid,$2::uuid,'rooms_demo',$3,$4,'pending',$5,'RUB',jsonb_build_object('flow','local_demo','expiresAt',$6::text)
        )
        returning id::text, booking_id::text, status, provider, provider_payment_id, amount, currency,
          masked_card, receipt_number, created_at, paid_at
      `, [paymentId, bookingId, `ROOMS-DEMO-${randomUUID()}`, `booking:${bookingId}:prepayment:v1`, booking.prepayment, iso(booking.payment_hold_expires_at)]);
      await client.query("commit");
      return fromRow(inserted.rows[0]!, booking.payment_hold_expires_at);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeDemo(clientId: string, paymentId: string): Promise<PaymentRecord> {
    await this.releaseExpired();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<PaymentRow & PaymentBookingRow>(`
        select payment.id::text, payment.booking_id::text, payment.status, payment.provider,
          payment.provider_payment_id, payment.amount, payment.currency, payment.masked_card,
          payment.receipt_number, payment.created_at, payment.paid_at,
          booking.status as booking_status, booking.payment_hold_expires_at
        from payment_transactions payment
        join bookings booking on booking.id = payment.booking_id
        where payment.id = $1::uuid and booking.client_id = $2::uuid and payment.provider = 'rooms_demo'
        for update of payment, booking
      `, [paymentId, clientId]);
      const row = result.rows[0] as (PaymentRow & { booking_status: string; payment_hold_expires_at: Date | string | null }) | undefined;
      if (!row) throw new PaymentActionError(404, "PAYMENT_NOT_FOUND", "Платёж не найден в вашем кабинете.");
      if (row.status === "paid" && row.booking_status === "paid") {
        await client.query("commit");
        return fromRow(row, row.paid_at ?? row.created_at);
      }
      if (row.booking_status !== "awaiting_payment" || !row.payment_hold_expires_at) paymentUnavailable(row.booking_status);
      if (new Date(row.payment_hold_expires_at).getTime() <= Date.now()) paymentUnavailable("expired");
      const receipt = receiptNumber();
      const paid = await client.query<PaymentRow>(`
        update payment_transactions
        set status = 'paid', masked_card = '•••• 4242', receipt_number = $2,
          provider_payload = provider_payload || jsonb_build_object('completedBy','local_demo'),
          paid_at = now(), updated_at = now()
        where id = $1::uuid
        returning id::text, booking_id::text, status, provider, provider_payment_id, amount, currency,
          masked_card, receipt_number, created_at, paid_at
      `, [paymentId, receipt]);
      await client.query(`
        update bookings
        set status = 'paid', payment_hold_expires_at = null, updated_at = now()
        where id = $1::uuid
      `, [row.booking_id]);
      await client.query(`
        update room_reservations
        set source_type = case when source_type = 'payment_hold' then 'booking'::reservation_source else source_type end,
          expires_at = null,
          details = details || jsonb_build_object('paymentId',$2::text,'paidAt',now()),
          active = true
        where booking_id = $1::uuid and active
      `, [row.booking_id, paymentId]);
      await client.query(`
        insert into booking_status_history (booking_id, from_status, to_status, actor_id, actor_role, title, details)
        values ($1::uuid,'awaiting_payment','paid',$2::uuid,'client','Предоплата внесена',$3)
      `, [row.booking_id, clientId, `Транзакция ${paymentId}`]);
      await client.query("commit");
      return fromRow(paid.rows[0]!, paid.rows[0]!.paid_at ?? paid.rows[0]!.created_at);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseExpired(): Promise<void> {
    await this.pool.query(`/* rooms:expire-payment-holds-before-payment */
      with expired as (
        update bookings
        set status = 'expired', payment_hold_expires_at = null, updated_at = now()
        where status = 'awaiting_payment'
          and payment_hold_expires_at is not null
          and payment_hold_expires_at <= now()
        returning id
      ), released as (
        update room_reservations reservation set active = false
        from expired
        where reservation.booking_id = expired.id and reservation.active
        returning reservation.id
      )
      insert into booking_status_history (booking_id, from_status, to_status, actor_role, title, details)
      select id, 'awaiting_payment', 'expired', 'admin', 'Время предоплаты истекло',
        'Слот автоматически освобождён через 15 минут'
      from expired
    `);
  }
}
