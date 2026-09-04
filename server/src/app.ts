import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthConflictError,
  AuthService,
  hashPassword,
  MemoryAuthRepository,
  normalizeRussianPhone,
  passwordResetLifetimeSeconds,
  publicUser,
  type AuthRepository,
  type IssuedAuthSession,
  type UserRole,
} from "./auth.js";
import { MemoryBookingRepository, type BookingRecord, type BookingRepository, type BookingStatusGroup, type PartnerBookingStatusGroup } from "./bookings.js";
import { MemoryCatalogRepository, type CatalogRepository } from "./catalog.js";
import { MemoryPaymentRepository, type PaymentRecord, type PaymentRepository } from "./payments.js";
import type { SberCallbackPayload } from "./paymentGateway.js";
import {
  MAX_PHOTO_BYTES,
  MemoryPhotoStorage,
  processPhoto,
  type PhotoStorage,
  type PhotoVariant,
} from "./media.js";
import {
  MemoryNotificationRepository,
  NotificationCipher,
  NotificationService,
  type NotificationChannel,
  type NotificationDeliveryQuery,
  type NotificationDeliveryStatus,
  type NotificationRepository,
  type PublicNotificationDelivery,
} from "./notifications.js";
import {
  MemoryPartnerCatalogRepository,
  type AdminModerationQuery,
  type PartnerCatalogRepository,
  type PartnerRoomWrite,
  type PartnerScheduleExceptionWrite,
  type PartnerVenueWrite,
} from "./partnerCatalog.js";
import {
  MemoryPartnerReservationRepository,
  type ManualReservationSource,
  type PartnerReservationInput,
  type PartnerReservationRepository,
  type PartnerReservationType,
  type TechnicalCategory,
} from "./reservations.js";
import {
  MemoryReviewRepository,
  type ReviewQueryStatus,
  type ReviewRepository,
  type ReviewStatus,
} from "./reviews.js";
import {
  MemorySupportRepository,
  type SupportActorRole,
  type SupportQueryStatus,
  type SupportRepository,
  type SupportStatus,
} from "./support.js";
import {
  MemoryFinanceRepository,
  type BankAccountQueryStatus,
  type FinanceActorRole,
  type FinancePayoutQueryStatus,
  type FiscalReceiptQueryStatus,
  type FinanceRefundQueryStatus,
  type FinanceRepository,
} from "./finance.js";
import { MemoryFiscalReceiptRepository, type FiscalReceiptRepository } from "./receipts.js";
import { MemoryRefundRepository, type RefundRepository } from "./refunds.js";
import {
  MemoryPartnerLeadRepository,
  PartnerLeadConflictError,
  PartnerLeadStateError,
  type PartnerLeadQueryStatus,
  type PartnerLeadRepository,
  type PartnerLeadStatus,
} from "./partnerLeads.js";
import {
  MemoryPartnerInvitationRepository,
  PartnerInvitationError,
  partnerInvitationLifetimeSeconds,
  type PartnerInvitationRepository,
} from "./partnerInvitations.js";
import {
  MemoryTwoFactorRepository,
  TwoFactorCipher,
  TwoFactorError,
  TwoFactorService,
  twoFactorRecoveryLifetimeSeconds,
  type TwoFactorRecoveryDecision,
  type TwoFactorRecoveryQueryStatus,
  type TwoFactorRecoveryRecord,
  type TwoFactorRepository,
} from "./twoFactor.js";
import {
  AuthRateLimiter,
  MemoryRateLimitRepository,
  type RateLimitRepository,
} from "./rateLimits.js";
import { availabilityForRoom, intersectAvailability, isIsoDate, MOSCOW_TIMEZONE, moscowToday } from "./availability.js";
import { planBooking, roomPriceForBooking } from "./planning.js";
import type {
  AvailabilityWindow,
  PublicReviewPage,
  PublicRoomDetail,
  PublicRoomSummary,
  Room,
  RoomSearchFilters,
  Venue,
} from "./types.js";

interface AppConfig {
  publicSiteUrl: string;
  publicApiUrl: string;
  corsOrigins: string[];
  logger: boolean;
  repository: CatalogRepository;
  authRepository: AuthRepository;
  bookingRepository: BookingRepository;
  paymentRepository: PaymentRepository;
  reservationRepository: PartnerReservationRepository;
  partnerCatalogRepository: PartnerCatalogRepository;
  partnerLeadRepository: PartnerLeadRepository;
  partnerInvitationRepository: PartnerInvitationRepository;
  twoFactorRepository: TwoFactorRepository;
  rateLimitRepository: RateLimitRepository;
  notificationRepository: NotificationRepository;
  reviewRepository: ReviewRepository;
  supportRepository: SupportRepository;
  financeRepository: FinanceRepository;
  receiptRepository: FiscalReceiptRepository;
  refundRepository: RefundRepository;
  photoStorage: PhotoStorage;
  backupStatusFile: string | null;
  authTokenSecret: string;
  rateLimitHashKey: string;
  twoFactorEncryptionKey: string;
  enforceTwoFactor: boolean;
  notificationEncryptionKey: string;
  productionMode: boolean;
  secureCookies: boolean;
  enableDemoPayments: boolean;
  exposePasswordResetToken: boolean;
}

interface SearchQuery {
  city: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  guests?: number;
  type?: string;
  features?: string;
  maxPricePerHour?: number;
  sort?: "rating" | "price" | "capacity";
}

interface RoomParams {
  roomId: string;
}

interface CityParams {
  cityId: string;
}

interface RoomQuery {
  date?: string;
}

interface AvailabilityBody {
  roomIds: string[];
  date: string;
  durationMinutes: number;
  preferredTime?: string;
  guests?: number;
}

interface PlanningPreviewBody {
  roomSets: Array<{ id: string; roomIds: string[] }>;
  date: string;
  preferredTime: string;
  durationMinutes: number;
  guests: number;
  maxTotalPriceRub?: number;
  maxVariants?: number;
  maxVariantsPerRoomSet?: number;
  requiredFeatures?: string[];
  requestedServiceIds?: string[];
}

interface ClientRegistrationBody {
  name: string;
  email: string;
  phone: string;
  city: string;
  password: string;
  legal: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: string;
  };
}

interface LoginBody {
  login: string;
  password: string;
}

interface TwoFactorCompleteBody {
  challengeToken: string;
  code: string;
}

interface TwoFactorRecoveryRequestBody {
  challengeToken: string;
}

interface TwoFactorRecoveryQuerystring {
  status?: TwoFactorRecoveryQueryStatus;
  limit?: number;
}

interface TwoFactorRecoveryParams {
  recoveryId: string;
}

interface TwoFactorRecoveryDecisionBody {
  status: TwoFactorRecoveryDecision;
  comment?: string;
}

interface PasswordResetRequestBody {
  login: string;
}

interface PasswordResetConfirmBody {
  token: string;
  newPassword: string;
}

interface SessionParams {
  sessionId: string;
}

interface ClientProfileBody {
  name: string;
  email: string;
  phone: string;
  city: string;
  currentPassword?: string;
  newPassword?: string;
}

interface NotificationSettingsBody {
  siteEnabled?: true;
  emailEnabled: boolean;
  emailAddress?: string | null;
  telegramEnabled: boolean;
  telegramChatId?: string | null;
}

interface NotificationDeliveryQuerystring {
  status?: NotificationDeliveryStatus;
  channel?: NotificationChannel;
  limit?: number;
}

interface BookingCreateBody {
  primaryRoomId: string;
  roomIds: string[];
  startsAt: string;
  durationMinutes: number;
  guests: number;
  eventType?: string | null;
  eventName?: string | null;
  serviceIds?: string[];
  onSitePaymentMethod?: "card" | "cash";
  comment?: string;
  legal: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: string;
  };
}

interface BookingQuery {
  statusGroup?: BookingStatusGroup;
}

interface PartnerBookingQuery {
  statusGroup?: PartnerBookingStatusGroup;
}

interface BookingParams {
  bookingId: string;
}

interface BookingCancelBody {
  reason: string;
}

interface SupportParams {
  supportId: string;
}

interface SupportOpenBody {
  topic: string;
  body: string;
}

interface SupportMessageBody {
  body: string;
}

interface SupportStatusBody {
  status: SupportStatus;
}

interface SupportQuerystring {
  status?: SupportQueryStatus;
  limit?: number;
}

interface PartnerBankAccountBody {
  bankName: string;
  bik: string;
  settlementAccount: string;
}

interface AccountingListQuerystring {
  status?: string;
  limit?: number;
}

interface VenueFinanceParams {
  venueId: string;
}

interface RefundParams {
  refundId: string;
}

interface ReceiptParams {
  receiptId: string;
}

interface PayoutParams {
  payoutId: string;
}

interface ProviderOperationBody {
  providerOperationId?: string;
}

interface CreatePayoutsBody {
  bookingIds?: string[];
  scheduledFor?: string;
}

interface PaymentParams {
  paymentId: string;
}

type SberWebhookBody = SberCallbackPayload;

interface PartnerBookingRejectBody {
  reason: string;
}

interface PartnerBookingProposalBody {
  startsAt: string;
  durationMinutes: number;
  comment?: string;
}

interface BookingProposalActionBody {
  proposalId: string;
}

interface BookingMessageBody {
  body: string;
}

interface PartnerReservationBody {
  roomId: string;
  type: PartnerReservationType;
  category?: TechnicalCategory;
  startsAt: string;
  endsAt: string;
  clientName?: string | null;
  clientPhone?: string | null;
  guests?: number | null;
  amount?: number;
  source?: ManualReservationSource | null;
  comment?: string;
}

interface PartnerReservationQuery {
  roomId?: string;
  dateFrom?: string;
  dateTo?: string;
  includeCancelled?: boolean;
}

interface ReservationParams {
  reservationId: string;
}

interface ReservationCancelBody {
  reason: string;
}

interface PartnerRoomParams {
  roomId: string;
}

interface PartnerPhotoParams {
  photoId: string;
}

interface PartnerPhotoOrderBody {
  photoIds: string[];
}

interface ReviewParams {
  reviewId: string;
}

interface ReviewSubmitBody {
  roomId: string;
  rating: number;
  body: string;
}

interface ReviewDecisionBody {
  status: ReviewStatus;
  comment?: string;
}

interface ReviewReplyBody {
  body: string;
}

interface ReviewQuerystring {
  status?: ReviewQueryStatus;
  limit?: number;
}

interface MediaParams {
  storageKey: string;
  fileName: string;
}

interface PartnerScheduleDateParams {
  date: string;
}

interface AdminModerationParams {
  moderationId: string;
}

interface AdminModerationQuerystring {
  status?: AdminModerationQuery["status"];
  limit?: number;
}

interface AdminModerationDecisionBody {
  comment?: string;
}

interface PartnerLeadBody {
  city: string;
  venueTitle: string;
  address: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  venueType: string;
  roomCount: number;
  comment: string;
  legal: {
    termsVersion: string;
    privacyVersion: string;
    termsAccepted: true;
    privacyAccepted: true;
  };
}

interface AdminPartnerLeadQuerystring {
  status?: PartnerLeadQueryStatus;
  limit?: number;
}

interface AdminPartnerLeadParams {
  leadId: string;
}

interface AdminPartnerLeadDecisionBody {
  status: Exclude<PartnerLeadStatus, "new">;
  comment?: string;
}

interface PartnerInvitationTokenBody {
  token: string;
}

interface PartnerInvitationAcceptBody extends PartnerInvitationTokenBody {
  password: string;
  legal: {
    termsVersion: string;
    privacyVersion: string;
    termsAccepted: true;
    privacyAccepted: true;
  };
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetContentTypes: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const partnerReservationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["roomId", "type", "startsAt", "endsAt"],
  properties: {
    roomId: { type: "string", minLength: 36, maxLength: 36 },
    type: { type: "string", enum: ["manual_booking", "technical"] },
    category: { type: "string", enum: ["technical", "service", "private"] },
    startsAt: { type: "string", minLength: 20, maxLength: 40 },
    endsAt: { type: "string", minLength: 20, maxLength: 40 },
    clientName: { type: ["string", "null"], maxLength: 100 },
    clientPhone: { type: ["string", "null"], maxLength: 30 },
    guests: { type: ["integer", "null"], minimum: 1, maximum: 1000 },
    amount: { type: "number", minimum: 0, maximum: 100_000_000 },
    source: { type: ["string", "null"], enum: ["phone", "whatsapp", "telegram", "walk_in", "other", null] },
    comment: { type: "string", maxLength: 2000 },
  },
} as const;
const reservationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reservationId"],
  properties: { reservationId: { type: "string", minLength: 36, maxLength: 36 } },
} as const;
const partnerWeekScheduleDaySchema = {
  type: "object",
  additionalProperties: false,
  required: ["weekday", "enabled", "opensAtHour", "closesAtHour"],
  properties: {
    weekday: { type: "integer", minimum: 1, maximum: 7 },
    enabled: { type: "boolean" },
    opensAtHour: { type: "number", minimum: 0, maximum: 23.5, multipleOf: 0.5 },
    closesAtHour: { type: "number", minimum: 0.5, maximum: 30, multipleOf: 0.5 },
  },
} as const;
const partnerVenueWriteSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "city", "address", "venueType", "description", "rules", "contactName", "contactPhone",
    "contactEmail", "amenities", "paymentMethods", "weekSchedule",
  ],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 160 },
    city: { type: "string", minLength: 2, maxLength: 100 },
    address: { type: "string", minLength: 3, maxLength: 300 },
    venueType: { type: "string", minLength: 2, maxLength: 120 },
    description: { type: "string", minLength: 10, maxLength: 5000 },
    rules: { type: "string", maxLength: 5000 },
    contactName: { type: "string", minLength: 2, maxLength: 120 },
    contactPhone: { type: "string", minLength: 6, maxLength: 30 },
    contactEmail: { type: "string", maxLength: 320 },
    amenities: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 100 } },
    paymentMethods: {
      type: "array", minItems: 1, maxItems: 2, uniqueItems: true,
      items: { type: "string", enum: ["card", "cash"] },
    },
    weekSchedule: { type: "array", minItems: 7, maxItems: 7, items: partnerWeekScheduleDaySchema },
  },
} as const;
const partnerRoomWriteSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "subtitle", "type", "description", "rules", "promotion", "capacityMin", "capacityMax",
    "pricePerHour", "minimumHours", "bufferMinutes", "opensAtHour", "closesAtHour", "features", "tags",
    "services", "status",
  ],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 160 },
    subtitle: { type: "string", minLength: 2, maxLength: 160 },
    type: { type: "string", minLength: 2, maxLength: 80 },
    description: { type: "string", minLength: 10, maxLength: 5000 },
    rules: { type: "string", maxLength: 5000 },
    promotion: { type: "string", maxLength: 2000 },
    capacityMin: { type: "integer", minimum: 1, maximum: 1000 },
    capacityMax: { type: "integer", minimum: 1, maximum: 1000 },
    pricePerHour: { type: "number", minimum: 0, maximum: 100_000_000 },
    minimumHours: { type: "number", minimum: 0.5, maximum: 24, multipleOf: 0.5 },
    bufferMinutes: { type: "integer", enum: [0, 15, 30, 45, 60] },
    opensAtHour: { type: "number", minimum: 0, maximum: 23.5, multipleOf: 0.5 },
    closesAtHour: { type: "number", minimum: 0.5, maximum: 30, multipleOf: 0.5 },
    features: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
    tags: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
    services: {
      type: "array", maxItems: 50,
      items: {
        type: "object", additionalProperties: false, required: ["name", "description", "price"],
        properties: {
          id: { type: "string", maxLength: 100 },
          name: { type: "string", minLength: 1, maxLength: 160 },
          description: { type: "string", maxLength: 1000 },
          price: { type: "number", minimum: 0, maximum: 100_000_000 },
        },
      },
    },
    priceRules: {
      type: "array", maxItems: 30,
      items: {
        type: "object", additionalProperties: false,
        required: ["label", "weekdays", "startsAtHour", "endsAtHour", "pricePerHour", "active"],
        properties: {
          id: { type: "string", maxLength: 100 },
          label: { type: "string", minLength: 1, maxLength: 160 },
          weekdays: { type: "array", minItems: 1, maxItems: 7, uniqueItems: true, items: { type: "integer", minimum: 1, maximum: 7 } },
          startsAtHour: { type: "number", minimum: 0, maximum: 23.5, multipleOf: 0.5 },
          endsAtHour: { type: "number", minimum: 0.5, maximum: 30, multipleOf: 0.5 },
          pricePerHour: { type: "number", minimum: 0, maximum: 100_000_000 },
          active: { type: "boolean" },
        },
      },
    },
    status: { type: "string", enum: ["review", "published", "hidden"] },
  },
} as const;
const partnerPhotoOrderBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["photoIds"],
  properties: {
    photoIds: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
    },
  },
} as const;
const reviewParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviewId"],
  properties: { reviewId: { type: "string", minLength: 36, maxLength: 36 } },
} as const;
const reviewSubmitBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["roomId", "rating", "body"],
  properties: {
    roomId: { type: "string", minLength: 36, maxLength: 36 },
    rating: { type: "integer", minimum: 1, maximum: 5 },
    body: { type: "string", minLength: 10, maxLength: 3000 },
  },
} as const;
const partnerScheduleDateParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["date"],
  properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
} as const;
const partnerScheduleExceptionWriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "opensAtHour", "closesAtHour", "note"],
  properties: {
    mode: { type: "string", enum: ["closed", "custom"] },
    opensAtHour: { type: ["number", "null"], minimum: 0, maximum: 23.5, multipleOf: 0.5 },
    closesAtHour: { type: ["number", "null"], minimum: 0.5, maximum: 30, multipleOf: 0.5 },
    note: { type: "string", maxLength: 500 },
  },
} as const;
const partnerLeadBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "city", "venueTitle", "address", "contactName", "contactPhone", "contactEmail",
    "venueType", "roomCount", "comment", "legal",
  ],
  properties: {
    city: { type: "string", minLength: 2, maxLength: 120 },
    venueTitle: { type: "string", minLength: 2, maxLength: 180 },
    address: { type: "string", minLength: 3, maxLength: 300 },
    contactName: { type: "string", minLength: 2, maxLength: 120 },
    contactPhone: { type: "string", minLength: 10, maxLength: 30 },
    contactEmail: { type: "string", minLength: 5, maxLength: 320 },
    venueType: { type: "string", minLength: 2, maxLength: 120 },
    roomCount: { type: "integer", minimum: 1, maximum: 100 },
    comment: { type: "string", maxLength: 2000 },
    legal: {
      type: "object",
      additionalProperties: false,
      required: ["termsVersion", "privacyVersion", "termsAccepted", "privacyAccepted"],
      properties: {
        termsVersion: { type: "string", minLength: 1, maxLength: 80 },
        privacyVersion: { type: "string", minLength: 1, maxLength: 80 },
        termsAccepted: { const: true },
        privacyAccepted: { const: true },
      },
    },
  },
} as const;
const adminPartnerLeadParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["leadId"],
  properties: { leadId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
} as const;
const adminPartnerLeadDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string", enum: ["review", "approved", "rejected"] },
    comment: { type: "string", maxLength: 1000 },
  },
} as const;
const partnerInvitationTokenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    token: { type: "string", pattern: "^[A-Za-z0-9_-]{40,100}$" },
  },
} as const;
const partnerInvitationAcceptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["token", "password", "legal"],
  properties: {
    token: partnerInvitationTokenSchema.properties.token,
    password: { type: "string", minLength: 8, maxLength: 128 },
    legal: {
      type: "object",
      additionalProperties: false,
      required: ["termsVersion", "privacyVersion", "termsAccepted", "privacyAccepted"],
      properties: {
        termsVersion: { type: "string", minLength: 1, maxLength: 100 },
        privacyVersion: { type: "string", minLength: 1, maxLength: 100 },
        termsAccepted: { const: true },
        privacyAccepted: { const: true },
      },
    },
  },
} as const;

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: unknown[] = [],
  ) {
    super(message);
  }
}

function loginAttemptKey(login: string): string {
  const normalized = normalizeRussianPhone(login) ?? login.trim().toLocaleLowerCase("ru-RU");
  return createHash("sha256").update(normalized).digest("hex");
}

function maskedIp(value: string | null): string {
  const ip = String(value ?? "").trim();
  if (!ip) return "не определён";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(ip)) return `${ip.split(".").slice(0, 3).join(".")}.x`;
  if (ip.includes(":")) return `${ip.split(":").filter(Boolean).slice(0, 3).join(":")}::`;
  return "скрыт";
}

function deviceLabel(userAgent: string | null): string {
  const value = String(userAgent ?? "");
  const browser = /Edg\//u.test(value)
    ? "Microsoft Edge"
    : /Firefox\//u.test(value)
      ? "Firefox"
      : /Chrome\//u.test(value)
        ? "Chrome"
        : /Safari\//u.test(value)
          ? "Safari"
          : "неизвестный браузер";
  const platform = /Android/u.test(value)
    ? "Android"
    : /iPhone|iPad/u.test(value)
      ? "iPhone/iPad"
      : /Windows/u.test(value)
        ? "Windows"
        : /Macintosh/u.test(value)
          ? "macOS"
          : /Linux/u.test(value)
            ? "Linux"
            : "неизвестное устройство";
  return `${browser}, ${platform}`;
}

function email(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : null;
}

function cookieValue(header: string | undefined, name: string): string | null {
  const item = String(header ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return null;
  }
}

function refreshCookie(reply: FastifyReply, token: string, maxAge: number, secure: boolean): void {
  const security = secure ? "; Secure" : "";
  reply.header("Set-Cookie", `rooms_refresh=${encodeURIComponent(token)}; Path=/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${security}`);
}

function clearRefreshCookie(reply: FastifyReply, secure: boolean): void {
  const security = secure ? "; Secure" : "";
  reply.header("Set-Cookie", `rooms_refresh=; Path=/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0${security}`);
}

function authResponse(session: IssuedAuthSession) {
  return { user: session.user, accessToken: session.accessToken, expiresIn: session.expiresIn };
}

function moscowDateTime(value: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${item.year}-${item.month}-${item.day}`, time: `${item.hour}:${item.minute}` };
}

function moneyAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function relativeMoscowHour(value: Date, baseDate: string): number {
  const local = moscowDateTime(value);
  const dayOffset = Math.round((Date.parse(`${local.date}T00:00:00Z`) - Date.parse(`${baseDate}T00:00:00Z`)) / 86_400_000);
  const [hours, minutes] = local.time.split(":").map(Number);
  return dayOffset * 24 + (hours ?? 0) + (minutes ?? 0) / 60;
}

function blockedChatContact(text: string): string | null {
  const lower = text.toLocaleLowerCase("ru-RU");
  if (/[a-zа-я0-9._%+-]+@[a-zа-я0-9.-]+\.[a-zа-я]{2,}/iu.test(text)) return "email";
  if (/(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|[a-zа-я0-9-]+\.(?:ru|рф|com|net|org)\b)/iu.test(text)) return "ссылку";
  if (/(^|\s)@[a-zа-я0-9_]{3,}/iu.test(text) || /(telegram|телеграм|whatsapp|ватсап|viber|вайбер|instagram|инстаграм|вконтакте|\bvk\b)/iu.test(lower)) {
    return "контакт мессенджера";
  }
  const phoneLike = text.match(/\+?\d[\d\s()\-]{7,}\d/g) ?? [];
  return phoneLike.some((value) => (value.match(/\d/g) ?? []).length >= 10) ? "номер телефона" : null;
}

function photoUrl(siteUrl: string, apiUrl: string, path: string): string {
  if (/^https?:\/\//iu.test(path) || path.startsWith("data:")) return path;
  const selectedBase = path.startsWith("/media/") ? apiUrl : siteUrl;
  const base = selectedBase.endsWith("/") ? selectedBase : `${selectedBase}/`;
  return new URL(path.replace(/^\//, ""), base).toString();
}

async function presentRoom(
  repository: CatalogRepository,
  room: Room,
  publicSiteUrl: string,
  publicApiUrl: string,
  date?: string,
  durationMinutes = room.minimumHours * 60,
  preferredTime?: string,
): Promise<PublicRoomSummary> {
  const venue = await repository.findVenue(room.venueId);
  if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Площадка помещения не найдена.");
  const nearestWindows = date
    ? (() => {
        const windows = availabilityForRoom(room, date, durationMinutes, preferredTime, 30, room.bufferMinutes, room.bufferMinutes);
        const exact = windows.find((window) => window.exactMatch);
        return exact ? [exact, ...windows.filter((window) => window !== exact).slice(0, 3)] : windows.slice(0, 4);
      })()
    : [];
  return {
    id: room.id,
    slug: room.slug,
    venue,
    title: room.title,
    subtitle: room.subtitle,
    type: room.type,
    capacityMin: room.capacityMin,
    capacityMax: room.capacityMax,
    pricePerHour: room.pricePerHour,
    minimumHours: room.minimumHours,
    rating: room.rating,
    reviewCount: room.reviewCount,
    features: room.features,
    tags: room.tags,
    promotion: room.promotion,
    photos: room.photoPaths.map((path) => photoUrl(publicSiteUrl, publicApiUrl, path)),
    nearestWindows,
  };
}

function normalizeFilters(query: SearchQuery): RoomSearchFilters {
  if (query.date && !isIsoDate(query.date)) throw new ApiError(400, "INVALID_DATE", "Дата должна существовать и иметь формат YYYY-MM-DD.");
  if (query.time && !query.date) throw new ApiError(400, "DATE_REQUIRED", "Для поиска по времени сначала укажите дату.");
  return {
    city: query.city.trim(),
    durationMinutes: query.durationMinutes ?? 120,
    features: String(query.features ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    sort: query.sort ?? "rating",
    ...(query.date ? { date: query.date } : {}),
    ...(query.time ? { time: query.time } : {}),
    ...(query.guests !== undefined ? { guests: query.guests } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.maxPricePerHour !== undefined ? { maxPricePerHour: query.maxPricePerHour } : {}),
  };
}

function errorPayload(code: string, message: string, details: unknown[] = []) {
  return { code, message, details, requestId: null };
}

export function buildApp(overrides: Partial<AppConfig> = {}): FastifyInstance {
  const repository = overrides.repository ?? new MemoryCatalogRepository();
  const bookingRepository = overrides.bookingRepository ?? new MemoryBookingRepository();
  const paymentRepository = overrides.paymentRepository
    ?? (bookingRepository instanceof MemoryBookingRepository ? new MemoryPaymentRepository(bookingRepository) : null);
  if (!paymentRepository) throw new Error("paymentRepository is required with a non-memory booking repository.");
  const reservationRepository = overrides.reservationRepository
    ?? (bookingRepository instanceof MemoryBookingRepository ? new MemoryPartnerReservationRepository(bookingRepository, repository) : null);
  if (!reservationRepository) throw new Error("reservationRepository is required with a non-memory booking repository.");
  const partnerCatalogRepository = overrides.partnerCatalogRepository ?? new MemoryPartnerCatalogRepository();
  const partnerLeadRepository = overrides.partnerLeadRepository ?? new MemoryPartnerLeadRepository();
  const authRepository = overrides.authRepository ?? new MemoryAuthRepository();
  const twoFactorRepository = overrides.twoFactorRepository ?? new MemoryTwoFactorRepository();
  const rateLimitRepository = overrides.rateLimitRepository ?? new MemoryRateLimitRepository();
  const partnerInvitationRepository = overrides.partnerInvitationRepository
    ?? (
      authRepository instanceof MemoryAuthRepository
      && bookingRepository instanceof MemoryBookingRepository
      && partnerCatalogRepository instanceof MemoryPartnerCatalogRepository
        ? new MemoryPartnerInvitationRepository(
            partnerLeadRepository,
            authRepository,
            bookingRepository,
            partnerCatalogRepository,
          )
        : null
    );
  if (!partnerInvitationRepository) {
    throw new Error("partnerInvitationRepository is required with non-memory authentication, booking or partner catalog repositories.");
  }
  const reviewRepository = overrides.reviewRepository ?? new MemoryReviewRepository(bookingRepository, repository);
  const supportRepository = overrides.supportRepository ?? new MemorySupportRepository(bookingRepository);
  const financeRepository = overrides.financeRepository ?? new MemoryFinanceRepository(bookingRepository, supportRepository);
  const receiptRepository = overrides.receiptRepository ?? new MemoryFiscalReceiptRepository();
  const refundRepository = overrides.refundRepository ?? new MemoryRefundRepository();
  const config: AppConfig = {
    publicSiteUrl: overrides.publicSiteUrl ?? "https://amodous.github.io/Rooms-bron",
    publicApiUrl: overrides.publicApiUrl ?? "http://127.0.0.1:3001",
    corsOrigins: overrides.corsOrigins ?? ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:4173", "http://127.0.0.1:4173", "https://amodous.github.io"],
    logger: overrides.logger ?? false,
    repository,
    authRepository,
    bookingRepository,
    paymentRepository,
    reservationRepository,
    partnerCatalogRepository,
    partnerLeadRepository,
    partnerInvitationRepository,
    twoFactorRepository,
    rateLimitRepository,
    notificationRepository: overrides.notificationRepository ?? new MemoryNotificationRepository(),
    reviewRepository,
    supportRepository,
    financeRepository,
    receiptRepository,
    refundRepository,
    photoStorage: overrides.photoStorage ?? new MemoryPhotoStorage(),
    backupStatusFile: overrides.backupStatusFile ?? null,
    authTokenSecret: overrides.authTokenSecret ?? "rooms-local-development-secret-change-me-2026",
    rateLimitHashKey: overrides.rateLimitHashKey ?? overrides.authTokenSecret ?? "rooms-local-development-secret-change-me-2026",
    twoFactorEncryptionKey: overrides.twoFactorEncryptionKey ?? overrides.authTokenSecret ?? "rooms-local-development-secret-change-me-2026",
    enforceTwoFactor: overrides.enforceTwoFactor ?? false,
    notificationEncryptionKey: overrides.notificationEncryptionKey ?? overrides.authTokenSecret ?? "rooms-local-development-secret-change-me-2026",
    productionMode: overrides.productionMode ?? false,
    secureCookies: overrides.secureCookies ?? false,
    enableDemoPayments: overrides.enableDemoPayments ?? true,
    exposePasswordResetToken: overrides.exposePasswordResetToken ?? false,
  };
  const app = Fastify({ logger: config.logger });
  const operationsStartedAt = Date.now();
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  const requestMetrics = {
    total: 0,
    inFlight: 0,
    durationTotalMs: 0,
    durationMaxMs: 0,
    slow: 0,
    byStatus: { success: 0, redirect: 0, clientError: 0, serverError: 0 },
    lastError: null as null | { at: string; code: string; statusCode: number },
  };
  void app.register(multipart, {
    limits: { files: 1, fields: 2, fileSize: MAX_PHOTO_BYTES },
  });
  const protectedRoles: readonly UserRole[] = config.enforceTwoFactor ? ["partner", "admin", "accountant"] : [];
  const auth = new AuthService(config.authRepository, config.authTokenSecret, protectedRoles);
  const twoFactor = new TwoFactorService(
    config.twoFactorRepository,
    new TwoFactorCipher(config.twoFactorEncryptionKey),
    protectedRoles,
  );
  const notifications = new NotificationService(
    config.notificationRepository,
    new NotificationCipher(config.notificationEncryptionKey),
  );
  const loginAccountAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "login_account",
    config.rateLimitHashKey,
    5,
  );
  const loginIpAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "login_ip",
    config.rateLimitHashKey,
    30,
  );
  const passwordResetAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "password_reset_request_ip",
    config.rateLimitHashKey,
  );
  const passwordResetConfirmAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "password_reset_confirm_ip",
    config.rateLimitHashKey,
  );
  const partnerLeadIpAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "partner_lead_ip",
    config.rateLimitHashKey,
    10,
    60 * 60 * 1000,
  );
  const planningIpAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "planning_preview_ip",
    config.rateLimitHashKey,
    100,
    60 * 1000,
  );
  const partnerInvitationAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "partner_invitation_ip",
    config.rateLimitHashKey,
    10,
    15 * 60 * 1000,
  );
  const twoFactorIpAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "two_factor_ip",
    config.rateLimitHashKey,
    20,
    10 * 60 * 1000,
  );
  const twoFactorRecoveryIpAttempts = new AuthRateLimiter(
    config.rateLimitRepository,
    "two_factor_recovery_ip",
    config.rateLimitHashKey,
    3,
    60 * 60 * 1000,
  );

  const queueNotification = async (label: string, task: () => Promise<unknown>): Promise<void> => {
    try {
      await task();
    } catch (error) {
      app.log.error({ err: error, notificationEvent: label }, "could not enqueue Rooms notification");
    }
  };

  const queuePaymentPaidNotifications = async (payment: PaymentRecord, booking: BookingRecord): Promise<void> => {
    await queueNotification("booking_prepayment_paid", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingClient(booking.id, {
        eventKey: "booking_prepayment_paid",
        title: `Предоплата по заявке ${booking.publicNumber} получена`,
        body: `Оплачено ${payment.amount.toLocaleString("ru-RU")} руб. Остаток на месте: ${booking.money.remainingOnSite.toLocaleString("ru-RU")} руб.`,
        dedupeKey: `prepayment-paid|${payment.paymentId}|client`,
      });
      await notifications.enqueueBookingVenue(booking.id, {
        eventKey: "booking_prepayment_paid",
        title: `Заявка ${booking.publicNumber} оплачена`,
        body: "Клиент внёс предоплату. Контакты клиента и детали брони доступны в кабинете Rooms.",
        dedupeKey: `prepayment-paid|${payment.paymentId}|venue`,
      });
    });
  };

  const rememberNotificationUser = async (user: IssuedAuthSession["user"]): Promise<void> => {
    await queueNotification("remember_user", async () => {
      await notifications.rememberUser(user);
      if (user.role === "partner") {
        const venue = await config.bookingRepository.getPartnerVenue(user.id);
        if (venue) await notifications.rememberVenueRecipient(venue.id, user);
      }
    });
  };

  const queueLoginNotification = (
    session: IssuedAuthSession,
    ip: string | null,
    userAgent: string | null,
  ): Promise<void> => queueNotification("security_login", () => notifications.enqueueUser(session.user, {
    eventKey: "security_login",
    title: "Новый вход в Rooms",
    body: `${deviceLabel(userAgent)} · IP ${maskedIp(ip)}. Если это были не вы, смените пароль и завершите остальные сессии в кабинете.`,
    dedupeKey: `security-login|${session.sessionId}`,
  }));

  const queueSuspiciousLoginNotification = (
    user: IssuedAuthSession["user"],
    ip: string | null,
    userAgent: string | null,
    accountKey: string,
  ): Promise<void> => queueNotification("security_login_failed", () => notifications.enqueueUser(user, {
    eventKey: "security_login_failed",
    title: "Несколько неудачных попыток входа",
    body: `${deviceLabel(userAgent)} · IP ${maskedIp(ip)}. Rooms временно ограничил подбор пароля. Если это были не вы, смените пароль.`,
    dedupeKey: `security-login-failed|${accountKey}|${Math.floor(Date.now() / (10 * 60 * 1000))}`,
  }));

  const publicRecoveryRecord = async (record: TwoFactorRecoveryRecord) => {
    const target = await config.authRepository.findUserById(record.userId);
    return {
      ...record,
      user: target ? publicUser(target) : null,
    };
  };

  const requirePartnerVenue = async (authorization: string | undefined) => {
    const current = await auth.authenticate(authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const assigned = await config.bookingRepository.getPartnerVenue(current.user.id);
    if (!assigned) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Для этого кабинета площадка ещё не назначена.");
    return { actorId: current.user.id, venueId: assigned.id };
  };

  const requireAdmin = async (authorization: string | undefined) => {
    const current = await auth.authenticate(authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в админку Rooms.");
    if (current.user.role !== "admin") throw new ApiError(403, "ADMIN_FORBIDDEN", "Этот раздел доступен только администратору Rooms.");
    return current.user;
  };

  const requireFinanceActor = async (authorization: string | undefined) => {
    const current = await auth.authenticate(authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в бухгалтерию Rooms.");
    if (current.user.role !== "admin" && current.user.role !== "accountant") {
      throw new ApiError(403, "ACCOUNTING_FORBIDDEN", "Финансовый раздел доступен бухгалтеру и администратору Rooms.");
    }
    return { ...current.user, role: current.user.role as FinanceActorRole };
  };

  const requireSupportActor = async (authorization: string | undefined) => {
    const current = await auth.authenticate(authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в Rooms, чтобы открыть обращение.");
    if (!["client", "partner", "admin"].includes(current.user.role)) {
      throw new ApiError(403, "SUPPORT_FORBIDDEN", "Обращения по брони доступны клиенту, площадке и Rooms.");
    }
    return { id: current.user.id, role: current.user.role as SupportActorRole };
  };

  const uploadPartnerPhoto = async (
    request: FastifyRequest,
    reply: FastifyReply,
    roomId: string | null,
  ) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    const upload = await request.file();
    if (!upload) throw new ApiError(400, "PHOTO_REQUIRED", "Выберите фотографию для загрузки.");
    const buffer = await upload.toBuffer();
    const processed = await processPhoto(buffer);
    const stored = await config.photoStorage.save(processed);
    try {
      const photo = await config.partnerCatalogRepository.addPhoto(venueId, roomId, actorId, {
        ...stored,
        originalName: basename(upload.filename || "photo").slice(0, 255),
        mimeType: processed.mimeType,
        fileSizeBytes: buffer.length,
        width: processed.width,
        height: processed.height,
      });
      if (!photo) {
        await config.photoStorage.remove(stored.storageKey);
        throw new ApiError(404, roomId ? "PARTNER_ROOM_NOT_FOUND" : "PARTNER_VENUE_NOT_FOUND", roomId
          ? "Помещение не найдено в кабинете этой площадки."
          : "Площадка кабинета не найдена.");
      }
      return reply.code(202).send(photo);
    } catch (error) {
      await config.photoStorage.remove(stored.storageKey);
      throw error;
    }
  };

  const validatePartnerVenueWrite = (body: PartnerVenueWrite) => {
    const weekdays = new Set(body.weekSchedule.map((day) => day.weekday));
    if (weekdays.size !== 7 || [...weekdays].some((weekday) => weekday < 1 || weekday > 7)) {
      throw new ApiError(400, "INVALID_WEEK_SCHEDULE", "Укажите график для каждого дня недели.");
    }
    const invalid = body.weekSchedule.find((day) => day.enabled && day.closesAtHour <= day.opensAtHour);
    if (invalid) throw new ApiError(400, "INVALID_WEEK_SCHEDULE", `В дне недели ${invalid.weekday} закрытие должно быть позже открытия.`);
    return body;
  };

  const validatePartnerRoomWrite = (body: PartnerRoomWrite) => {
    if (body.capacityMax < body.capacityMin) {
      throw new ApiError(400, "INVALID_ROOM_CAPACITY", "Максимальная вместимость не может быть меньше минимальной.");
    }
    if (body.closesAtHour <= body.opensAtHour) {
      throw new ApiError(400, "INVALID_ROOM_SCHEDULE", "Закрытие помещения должно быть позже открытия.");
    }
    for (const rule of body.priceRules ?? []) {
      if (rule.endsAtHour <= rule.startsAtHour) {
        throw new ApiError(400, "INVALID_PRICE_RULE", `В тарифе «${rule.label}» конец должен быть позже начала.`);
      }
    }
    return body;
  };

  const withReservationBlocks = async (rooms: Room[], date: string): Promise<Room[]> => {
    if (config.repository.storage !== "memory" || !rooms.length) return rooms;
    const blocks = await config.reservationRepository.blocksByDate(rooms.map((room) => room.id), date);
    return rooms.map((room) => ({
      ...room,
      blockedByDate: { ...room.blockedByDate, [date]: [...(room.blockedByDate[date] ?? []), ...(blocks[room.id] ?? [])] },
    }));
  };

  const validateBookingProposal = async (partnerId: string, bookingId: string, body: PartnerBookingProposalBody) => {
    const booking = await config.bookingRepository.findByPartner(partnerId, bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в очереди этой площадки.");
    if (!["pending", "proposed"].includes(booking.status)) {
      throw new ApiError(409, "BOOKING_STATE_CHANGED", "Для этой заявки уже нельзя предложить другое время.");
    }
    const startsAt = new Date(body.startsAt);
    if (!Number.isFinite(startsAt.getTime())) throw new ApiError(400, "INVALID_START", "Проверьте дату и время начала.");
    if (startsAt.getTime() < Date.now()) throw new ApiError(400, "START_IN_PAST", "Нельзя предложить прошедшее время.");
    const localStart = moscowDateTime(startsAt);
    const found = await Promise.all(booking.rooms.map((room) => config.repository.findRoom(room.id, localStart.date)));
    if (found.some((room) => room === null)) throw new ApiError(404, "ROOM_NOT_FOUND", "Одно из помещений заявки больше недоступно.");
    const selectedRooms = await withReservationBlocks(found as Room[], localStart.date);
    if (selectedRooms.some((room) => room.venueId !== booking.venue.id)) {
      throw new ApiError(409, "BOOKING_ROOMS_CHANGED", "Состав помещений изменился. Обновите заявку.");
    }
    if (body.durationMinutes < Math.max(...selectedRooms.map((room) => room.minimumHours * 60))) {
      throw new ApiError(400, "MINIMUM_DURATION", "Предложенная длительность меньше минимальной для одного из помещений.");
    }
    const windows = intersectAvailability(
      selectedRooms.map((room) => availabilityForRoom(room, localStart.date, body.durationMinutes, localStart.time)),
      body.durationMinutes,
      localStart.time,
    );
    const selectedWindow = windows.find((window) => new Date(window.startsAt).getTime() === startsAt.getTime());
    if (!selectedWindow) {
      throw new ApiError(409, "SLOT_UNAVAILABLE", "Это время уже недоступно. Выберите другое окно.", windows.slice(0, 6));
    }
    const roomTotal = moneyAmount(selectedRooms.reduce((sum, room) => sum
      + roomPriceForBooking(room, localStart.date, selectedWindow.startsAt, body.durationMinutes), 0));
    const serviceTotal = booking.money.serviceTotal;
    const total = moneyAmount(roomTotal + serviceTotal);
    const prepayment = Math.ceil(total * 0.3);
    const commission = Math.ceil(total * 0.15);
    return {
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + body.durationMinutes * 60_000).toISOString(),
      comment: body.comment?.trim() || "Площадка предложила другое свободное окно.",
      money: {
        roomTotal,
        serviceTotal,
        total,
        prepayment,
        remainingOnSite: moneyAmount(total - prepayment),
        currency: "RUB" as const,
      },
      commission,
      partnerAmount: moneyAmount(prepayment - commission),
    };
  };

  const validatePartnerReservation = async (partnerId: string, body: PartnerReservationBody): Promise<PartnerReservationInput> => {
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      throw new ApiError(400, "INVALID_RESERVATION_TIME", "Проверьте дату и время занятости.");
    }
    const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (durationMinutes < 30 || durationMinutes > 1440 || !Number.isInteger(durationMinutes / 30)) {
      throw new ApiError(400, "INVALID_RESERVATION_DURATION", "Интервал должен длиться от 30 минут до 24 часов с шагом 30 минут.");
    }
    if (startsAt.getTime() < Date.now() - 5 * 60_000) throw new ApiError(400, "RESERVATION_IN_PAST", "Нельзя занять помещение в прошедшем времени.");
    const startLocal = moscowDateTime(startsAt);
    const [venue, room] = await Promise.all([
      config.bookingRepository.getPartnerVenue(partnerId),
      config.repository.findRoom(body.roomId, startLocal.date),
    ]);
    if (!venue || !room || room.venueId !== venue.id) throw new ApiError(404, "PARTNER_ROOM_NOT_FOUND", "Помещение не найдено в кабинете этой площадки.");
    const startHour = relativeMoscowHour(startsAt, startLocal.date);
    const endHour = relativeMoscowHour(endsAt, startLocal.date);
    if (room.closesAtHour <= room.opensAtHour || startHour < room.opensAtHour || endHour > room.closesAtHour) {
      throw new ApiError(409, "RESERVATION_OUTSIDE_SCHEDULE", "Интервал находится вне рабочего времени помещения.");
    }
    const manual = body.type === "manual_booking";
    const clientName = body.clientName?.trim() || null;
    const clientPhone = body.clientPhone ? normalizeRussianPhone(body.clientPhone) : null;
    if (manual && (!clientName || clientName.length < 2)) throw new ApiError(400, "CLIENT_NAME_REQUIRED", "Укажите имя клиента для ручной брони.");
    if (manual && !clientPhone) throw new ApiError(400, "CLIENT_PHONE_REQUIRED", "Укажите российский номер клиента.");
    return {
      roomId: room.id,
      type: body.type,
      ...(!manual ? { category: body.category ?? "technical" } : {}),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      clientName,
      clientPhone,
      guests: manual ? Math.max(1, Number(body.guests) || 1) : null,
      amount: manual ? moneyAmount(Math.max(0, Number(body.amount) || 0)) : 0,
      source: manual ? body.source ?? "phone" : null,
      comment: body.comment?.trim() ?? "",
    };
  };

  void app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  app.addHook("onRequest", async (request) => {
    requestMetrics.total += 1;
    requestMetrics.inFlight += 1;
    requestStartedAt.set(request, Date.now());
  });

  app.addHook("onError", async (_request, reply, error) => {
    const statusCode = typeof error.statusCode === "number"
      ? error.statusCode
      : reply.statusCode >= 400 ? reply.statusCode : 500;
    requestMetrics.lastError = {
      at: new Date().toISOString(),
      code: typeof error.code === "string" ? error.code : "INTERNAL_ERROR",
      statusCode,
    };
  });

  app.addHook("onResponse", async (request, reply) => {
    const duration = Math.max(0, Date.now() - (requestStartedAt.get(request) ?? Date.now()));
    requestStartedAt.delete(request);
    requestMetrics.inFlight = Math.max(0, requestMetrics.inFlight - 1);
    requestMetrics.durationTotalMs += duration;
    requestMetrics.durationMaxMs = Math.max(requestMetrics.durationMaxMs, duration);
    if (duration >= 1000) requestMetrics.slow += 1;
    if (reply.statusCode >= 500) requestMetrics.byStatus.serverError += 1;
    else if (reply.statusCode >= 400) requestMetrics.byStatus.clientError += 1;
    else if (reply.statusCode >= 300) requestMetrics.byStatus.redirect += 1;
    else requestMetrics.byStatus.success += 1;
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.productionMode) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (request.url.split("?", 1)[0]?.startsWith("/v1/auth/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    return payload;
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ ...errorPayload(error.code, error.message, error.details), requestId: request.id });
    }
    if (error instanceof AuthConflictError) {
      return reply.status(409).send({ ...errorPayload("ACCOUNT_EXISTS", "Кабинет с такой почтой или телефоном уже существует."), requestId: request.id });
    }
    if (error instanceof TwoFactorError) {
      const messages = {
        TWO_FACTOR_CHALLENGE_UNAVAILABLE: "Проверка истекла или уже использована. Войдите ещё раз.",
        TWO_FACTOR_CODE_INVALID: "Неверный код. Проверьте приложение-аутентификатор и попробуйте снова.",
        TWO_FACTOR_ALREADY_ENABLED: "Двухфакторная защита для этого кабинета уже настроена.",
        TWO_FACTOR_RECOVERY_UNAVAILABLE: "Запрос восстановления недоступен. Войдите с паролем ещё раз.",
      } as const;
      return reply.status(error.statusCode).send({
        ...errorPayload(error.code, messages[error.code]),
        requestId: request.id,
      });
    }
    if (error instanceof PartnerLeadConflictError) {
      return reply.status(409).send({ ...errorPayload(error.code, "Заявка с такой почтой или телефоном уже находится в работе."), requestId: request.id });
    }
    if (error instanceof PartnerLeadStateError) {
      return reply.status(409).send({ ...errorPayload(error.code, "По заявке уже принято окончательное решение. Обновите очередь."), requestId: request.id });
    }
    if (error instanceof PartnerInvitationError) {
      const messages = {
        PARTNER_LEAD_NOT_APPROVED: "Сначала одобрите заявку площадки.",
        PARTNER_ACCOUNT_EXISTS: "Кабинет с такой почтой или телефоном уже существует.",
        PARTNER_INVITATION_UNAVAILABLE: "Ссылка активации недействительна или уже использована.",
      } as const;
      return reply.status(error.statusCode).send({ ...errorPayload(error.code, messages[error.code]), requestId: request.id });
    }
    if ("validation" in error && error.validation) {
      return reply.status(400).send({
        ...errorPayload("VALIDATION_ERROR", "Проверьте параметры запроса.", error.validation),
        requestId: request.id,
      });
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ ...errorPayload(error.code ?? "REQUEST_ERROR", error.message), requestId: request.id });
    }
    request.log.error(error);
    return reply.status(500).send({ ...errorPayload("INTERNAL_ERROR", "Не удалось обработать запрос."), requestId: request.id });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ ...errorPayload("ROUTE_NOT_FOUND", "Маршрут API не найден."), requestId: request.id });
  });

  const publicSiteBase = (request: FastifyRequest): URL => {
    const requestOrigin = `${request.protocol}://${request.headers.host ?? "localhost"}`;
    const siteUrl = config.productionMode ? config.publicSiteUrl : requestOrigin;
    return new URL(siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`);
  };
  const escapeXml = (value: string): string => value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
  const serializeJsonLd = (value: unknown): string => JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, (character) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  })[character] ?? character);

  app.get("/robots.txt", async (request, reply) => {
    const baseUrl = publicSiteBase(request);
    const body = config.productionMode
      ? [
          "User-agent: *",
          "Allow: /",
          "Disallow: /account",
          "Disallow: /partner",
          "Disallow: /admin",
          "Disallow: /accounting",
          `Sitemap: ${new URL("sitemap.xml", baseUrl).href}`,
          "",
        ].join("\n")
      : "User-agent: *\nDisallow: /\n";
    return reply.header("Cache-Control", "public, max-age=3600").type("text/plain; charset=utf-8").send(body);
  });

  app.get("/sitemap.xml", async (request, reply) => {
    const baseUrl = publicSiteBase(request);
    const venues = (await config.repository.listVenues())
      .filter((venue) => venue.publicationStatus === "published" && venue.partnerMode === "catalog");
    const cities = [...new Set(venues.map((venue) => venue.city))];
    const rooms = (await Promise.all(cities.map((city) => config.repository.searchRooms({
      city,
      durationMinutes: 60,
      features: [],
      sort: "rating",
    })))).flat();
    const venueById = new Map(venues.map((venue) => [venue.id, venue]));
    const entries = [
      { path: "", priority: "1.0", changefreq: "daily" },
      { path: "catalog", priority: "0.9", changefreq: "daily" },
      { path: "for-partners", priority: "0.5", changefreq: "monthly" },
      ...venues.map((venue) => ({ path: `venues/${encodeURIComponent(venue.slug)}`, priority: "0.8", changefreq: "weekly" })),
      ...rooms.flatMap((room) => {
        const venue = venueById.get(room.venueId);
        return venue ? [{
          path: `venues/${encodeURIComponent(venue.slug)}/rooms/${encodeURIComponent(room.slug)}`,
          priority: "0.8",
          changefreq: "daily",
        }] : [];
      }),
    ];
    const urls = entries.map((entry) => [
      "  <url>",
      `    <loc>${escapeXml(new URL(entry.path, baseUrl).href)}</loc>`,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      "  </url>",
    ].join("\n")).join("\n");
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    return reply.header("Cache-Control", "public, max-age=900").type("application/xml; charset=utf-8").send(body);
  });

  const servePublicSite = async (request: FastifyRequest, reply: FastifyReply) => {
    const source = await readFile(resolve(projectRoot, "index.html"), "utf8");
    const params = request.params as { venueSlug?: string; roomSlug?: string };
    const venueSlug = params.venueSlug?.trim() ?? "";
    const roomSlug = params.roomSlug?.trim() ?? "";
    const publicPath = request.url.split("?", 1)[0]?.replace(/\/+$/, "") || "/";
    const catalogRoute = publicPath === "/catalog";
    const partnerApplyRoute = publicPath === "/for-partners";
    const privateRoute = ({
      "/account": { title: "Личный кабинет — Rooms", description: "Заявки, избранные помещения и настройки профиля Rooms." },
      "/partner": { title: "Кабинет партнёра — Rooms", description: "Заявки, календарь и управление площадкой в Rooms." },
      "/partner/activate": { title: "Активация кабинета партнёра — Rooms", description: "Безопасная активация кабинета площадки Rooms." },
      "/admin": { title: "Админка — Rooms", description: "Защищённый кабинет управления сервисом Rooms." },
      "/accounting": { title: "Бухгалтерия — Rooms", description: "Защищённый кабинет финансовых операций Rooms." },
    } as const)[publicPath as "/account" | "/partner" | "/partner/activate" | "/admin" | "/accounting"];
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character] ?? character);
    let html = source;
    let routeFound = true;
    const runtimeConfig = JSON.stringify({
      mode: config.productionMode ? "production" : "development",
      apiBase: config.publicApiUrl.replace(/\/+$/u, ""),
    }).replace(/[<>&\u2028\u2029]/gu, (character) => ({
      "<": "\\u003c",
      ">": "\\u003e",
      "&": "\\u0026",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    })[character] ?? character);
    html = html.replace(
      "</head>",
      `<script data-rooms-runtime>window.ROOMS_CONFIG=Object.freeze(${runtimeConfig});</script>\n</head>`,
    );
    if (publicPath === "/") {
      const canonical = publicSiteBase(request).href;
      const structuredData = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Rooms",
        url: canonical,
        description: "Сервис поиска и бронирования приватных помещений для событий.",
        inLanguage: "ru-RU",
        potentialAction: {
          "@type": "SearchAction",
          target: `${new URL("catalog", canonical).href}?city={city}`,
          "query-input": "required name=city",
        },
      };
      html = html.replace(
        "</head>",
        `<meta property="og:url" content="${escapeHtml(canonical)}">\n<link rel="canonical" href="${escapeHtml(canonical)}">\n<script type="application/ld+json" data-rooms-structured>${serializeJsonLd(structuredData)}</script>\n</head>`,
      );
    }
    if (privateRoute) {
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(privateRoute.title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(privateRoute.description)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(privateRoute.title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(privateRoute.description)}">`)
        .replace("</head>", '<meta name="robots" content="noindex,nofollow" data-rooms-private="true">\n</head>');
    }
    if (catalogRoute) {
      const title = "Каталог помещений — Rooms";
      const description = "Подберите приватное помещение по городу, дате, времени, вместимости и удобствам в каталоге Rooms.";
      const requestOrigin = `${request.protocol}://${request.headers.host ?? "localhost"}`;
      const canonicalSiteUrl = config.productionMode ? config.publicSiteUrl : requestOrigin;
      const baseUrl = new URL(canonicalSiteUrl.endsWith("/") ? canonicalSiteUrl : `${canonicalSiteUrl}/`);
      const canonical = new URL("catalog", baseUrl).href;
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(description)}">`)
        .replace("</head>", `<meta property="og:url" content="${escapeHtml(canonical)}">\n<link rel="canonical" href="${escapeHtml(canonical)}">\n</head>`);
    }
    if (partnerApplyRoute) {
      const title = "Добавить площадку — Rooms";
      const description = "Подключите площадку к Rooms: добавьте помещения, расписание, услуги и получайте заявки на свободное время.";
      const requestOrigin = `${request.protocol}://${request.headers.host ?? "localhost"}`;
      const canonicalSiteUrl = config.productionMode ? config.publicSiteUrl : requestOrigin;
      const baseUrl = new URL(canonicalSiteUrl.endsWith("/") ? canonicalSiteUrl : `${canonicalSiteUrl}/`);
      const canonical = new URL("for-partners", baseUrl).href;
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(description)}">`)
        .replace("</head>", `<meta property="og:url" content="${escapeHtml(canonical)}">\n<link rel="canonical" href="${escapeHtml(canonical)}">\n</head>`);
    }
    if (venueSlug) {
      const venue = (await config.repository.listVenues()).find((item) => item.slug === venueSlug);
      const publicVenue = venue?.publicationStatus === "published" && venue.partnerMode === "catalog" ? venue : null;
      const room = roomSlug ? await config.repository.findRoom(roomSlug) : null;
      const publicRoom = room?.publicationStatus === "published" && room.venueId === publicVenue?.id ? room : null;
      routeFound = Boolean(publicVenue && (!roomSlug || publicRoom));
      if (publicVenue && routeFound) {
        const venueRooms = (await config.repository.searchRooms({
          city: publicVenue.city,
          durationMinutes: 60,
          features: [],
          sort: "rating",
        })).filter((item) => item.venueId === publicVenue.id);
        const representative = publicRoom ?? venueRooms[0] ?? null;
        const title = publicRoom
          ? `${publicRoom.title} в ${publicVenue.title} — Rooms`
          : `${publicVenue.title} — помещения для бронирования в ${publicVenue.city} | Rooms`;
        const description = publicRoom?.description || publicVenue.description || `${publicVenue.title}, ${publicVenue.address}. Бронирование приватных помещений в Rooms.`;
        const requestOrigin = `${request.protocol}://${request.headers.host ?? "localhost"}`;
        const canonicalSiteUrl = config.productionMode ? config.publicSiteUrl : requestOrigin;
        const baseUrl = new URL(canonicalSiteUrl.endsWith("/") ? canonicalSiteUrl : `${canonicalSiteUrl}/`);
        const canonical = new URL(`venues/${encodeURIComponent(publicVenue.slug)}${publicRoom ? `/rooms/${encodeURIComponent(publicRoom.slug)}` : ""}`, baseUrl).href;
        const image = representative?.photoPaths[0] ? photoUrl(config.publicSiteUrl, config.publicApiUrl, representative.photoPaths[0]) : "";
        const venueUrl = new URL(`venues/${encodeURIComponent(publicVenue.slug)}`, baseUrl).href;
        const address = {
          "@type": "PostalAddress",
          streetAddress: publicVenue.address,
          addressLocality: publicVenue.city,
          addressCountry: "RU",
        };
        const structuredData = publicRoom ? {
          "@context": "https://schema.org",
          "@type": "EventVenue",
          "@id": `${canonical}#room`,
          name: `${publicRoom.title} — ${publicVenue.title}`,
          url: canonical,
          description,
          image: publicRoom.photoPaths.map((path) => photoUrl(config.publicSiteUrl, config.publicApiUrl, path)),
          address,
          maximumAttendeeCapacity: publicRoom.capacityMax,
          isContainedInPlace: { "@type": "EventVenue", name: publicVenue.title, url: venueUrl },
          aggregateRating: publicRoom.reviewCount > 0 ? {
            "@type": "AggregateRating",
            ratingValue: publicRoom.rating,
            reviewCount: publicRoom.reviewCount,
            bestRating: 5,
          } : undefined,
          offers: {
            "@type": "Offer",
            price: publicRoom.pricePerHour,
            priceCurrency: "RUB",
            unitText: "HOUR",
            availability: "https://schema.org/InStock",
            url: canonical,
          },
        } : {
          "@context": "https://schema.org",
          "@type": "EventVenue",
          "@id": `${canonical}#venue`,
          name: publicVenue.title,
          url: canonical,
          description,
          image: image || undefined,
          address,
          amenityFeature: publicVenue.amenities.map((name) => ({ "@type": "LocationFeatureSpecification", name, value: true })),
          containsPlace: venueRooms.map((room) => ({
            "@type": "EventVenue",
            name: room.title,
            url: new URL(`venues/${encodeURIComponent(publicVenue.slug)}/rooms/${encodeURIComponent(room.slug)}`, baseUrl).href,
            maximumAttendeeCapacity: room.capacityMax,
          })),
        };
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
          .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
          .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(title)}">`)
          .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(description)}">`)
          .replace("</head>", `${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n` : ""}<meta property="og:url" content="${escapeHtml(canonical)}">\n<link rel="canonical" href="${escapeHtml(canonical)}">\n<script type="application/ld+json" data-rooms-structured>${serializeJsonLd(structuredData)}</script>\n</head>`);
      }
    }
    html = html.replace("</head>", '<base href="/">\n<meta name="rooms-routing" content="path">\n</head>');
    return reply.status(routeFound ? 200 : 404).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
  };
  const publicSlugSchema = {
    type: "object",
    required: ["venueSlug"],
    properties: {
      venueSlug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,79}$" },
      roomSlug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,79}$" },
    },
  } as const;

  app.get("/", servePublicSite);
  app.get("/catalog", servePublicSite);
  app.get("/for-partners", servePublicSite);
  app.get("/account", servePublicSite);
  app.get("/partner", servePublicSite);
  app.get("/partner/activate", servePublicSite);
  app.get("/admin", servePublicSite);
  app.get("/accounting", servePublicSite);
  app.get<{ Params: { venueSlug: string } }>("/venues/:venueSlug", {
    schema: { params: publicSlugSchema },
  }, servePublicSite);
  app.get<{ Params: { venueSlug: string; roomSlug: string } }>("/venues/:venueSlug/rooms/:roomSlug", {
    schema: { params: { ...publicSlugSchema, required: ["venueSlug", "roomSlug"] } },
  }, servePublicSite);

  app.get<{ Params: { assetName: string } }>("/assets/:assetName", {
    schema: {
      params: {
        type: "object",
        required: ["assetName"],
        properties: { assetName: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*\\.(jpg|jpeg|png|webp|svg)$" } },
      },
    },
  }, async (request, reply) => {
    const extension = request.params.assetName.split(".").pop()?.toLowerCase() ?? "";
    const asset = await readFile(resolve(projectRoot, "assets", request.params.assetName));
    return reply.header("Cache-Control", "public, max-age=3600").type(assetContentTypes[extension] ?? "application/octet-stream").send(asset);
  });

  app.get<{ Params: MediaParams }>("/media/:storageKey/:fileName", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["storageKey", "fileName"],
        properties: {
          storageKey: { type: "string", minLength: 36, maxLength: 36 },
          fileName: { type: "string", enum: ["original.webp", "landscape.webp", "portrait.webp"] },
        },
      },
    },
  }, async (request, reply) => {
    const variant = request.params.fileName.replace(".webp", "") as PhotoVariant;
    const photo = await config.photoStorage.read(request.params.storageKey, variant);
    if (!photo) throw new ApiError(404, "PHOTO_NOT_FOUND", "Фотография не найдена.");
    return reply.header("Cache-Control", "public, max-age=31536000, immutable").type("image/webp").send(photo);
  });

  app.get("/health", async () => ({
    status: "ok",
    database: config.repository.storage === "postgresql" ? "up" : "down",
    storage: config.repository.storage,
    media: config.photoStorage.storage,
    rateLimits: config.rateLimitRepository.storage,
    payments: config.paymentRepository.provider,
    time: new Date().toISOString(),
  }));

  app.get("/v1/cities", async () => config.repository.listCities());

  app.post<{ Body: PartnerLeadBody }>("/v1/partner-leads", {
    schema: { body: partnerLeadBodySchema },
  }, async (request, reply) => {
    const ipKey = request.ip;
    if (await partnerLeadIpAttempts.blocked(ipKey)) {
      throw new ApiError(429, "PARTNER_LEAD_RATE_LIMITED", "С этого адреса отправлено слишком много заявок. Попробуйте через час.");
    }
    const contactEmail = email(request.body.contactEmail);
    const contactPhone = normalizeRussianPhone(request.body.contactPhone);
    if (!contactEmail) throw new ApiError(400, "INVALID_EMAIL", "Проверьте электронную почту.");
    if (!contactPhone) throw new ApiError(400, "INVALID_PHONE", "Укажите российский номер телефона в формате +7.");
    const city = request.body.city.trim();
    const venueTitle = request.body.venueTitle.trim();
    const address = request.body.address.trim();
    const contactName = request.body.contactName.trim();
    const venueType = request.body.venueType.trim();
    const termsVersion = request.body.legal.termsVersion.trim();
    const privacyVersion = request.body.legal.privacyVersion.trim();
    if (city.length < 2 || venueTitle.length < 2 || address.length < 3 || contactName.length < 2 || venueType.length < 2) {
      throw new ApiError(400, "PARTNER_LEAD_FIELDS_REQUIRED", "Заполните город, площадку, адрес и контактное лицо.");
    }
    if (!termsVersion || !privacyVersion) throw new ApiError(400, "LEGAL_VERSION_REQUIRED", "Не удалось зафиксировать версии документов.");
    const record = await config.partnerLeadRepository.create({
      city,
      venueTitle,
      address,
      contactName,
      contactPhone,
      contactEmail,
      venueType,
      roomCount: request.body.roomCount,
      comment: request.body.comment.trim(),
      termsVersion,
      privacyVersion,
      consentedAt: new Date().toISOString(),
      requestIp: request.ip,
      requestUserAgent: String(request.headers["user-agent"] ?? "").slice(0, 500) || null,
    });
    await partnerLeadIpAttempts.fail(ipKey);
    return reply
      .header("Cache-Control", "no-store")
      .status(201)
      .send({ id: record.id, status: record.status, createdAt: record.createdAt });
  });

  app.post<{ Body: PartnerInvitationTokenBody }>("/v1/auth/partner-invitations/preview", {
    schema: { body: partnerInvitationTokenSchema },
  }, async (request, reply) => {
    const attemptKey = request.ip;
    if (await partnerInvitationAttempts.blocked(attemptKey)) {
      reply.header("Retry-After", "900");
      throw new ApiError(429, "PARTNER_INVITATION_RATE_LIMITED", "Слишком много попыток. Повторите через 15 минут.");
    }
    const tokenHash = createHash("sha256").update(request.body.token).digest("hex");
    const preview = await config.partnerInvitationRepository.preview(tokenHash);
    if (!preview) {
      await partnerInvitationAttempts.fail(attemptKey);
      throw new PartnerInvitationError(410, "PARTNER_INVITATION_UNAVAILABLE", "The invitation is invalid, expired or already used.");
    }
    await partnerInvitationAttempts.clear(attemptKey);
    return reply.header("Cache-Control", "no-store").send(preview);
  });

  app.post<{ Body: PartnerInvitationAcceptBody }>("/v1/auth/partner-invitations/accept", {
    schema: { body: partnerInvitationAcceptSchema },
  }, async (request, reply) => {
    const attemptKey = request.ip;
    if (await partnerInvitationAttempts.blocked(attemptKey)) {
      reply.header("Retry-After", "900");
      throw new ApiError(429, "PARTNER_INVITATION_RATE_LIMITED", "Слишком много попыток. Повторите через 15 минут.");
    }
    if (!/\p{L}/u.test(request.body.password) || !/\d/u.test(request.body.password)) {
      throw new ApiError(400, "WEAK_PASSWORD", "Пароль должен содержать буквы и хотя бы одну цифру.");
    }
    const acceptedAt = new Date().toISOString();
    const tokenHash = createHash("sha256").update(request.body.token).digest("hex");
    const activated = await config.partnerInvitationRepository.activate({
      tokenHash,
      passwordHash: await hashPassword(request.body.password),
      acceptedAt,
      termsVersion: request.body.legal.termsVersion.trim(),
      privacyVersion: request.body.legal.privacyVersion.trim(),
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    if (!activated) {
      await partnerInvitationAttempts.fail(attemptKey);
      throw new PartnerInvitationError(410, "PARTNER_INVITATION_UNAVAILABLE", "The invitation is invalid, expired or already used.");
    }
    const activatedUser = await config.authRepository.findUserById(activated.userId);
    if (!activatedUser || activatedUser.role !== "partner" || activatedUser.blockedAt !== null) {
      throw new ApiError(500, "PARTNER_ACTIVATION_FAILED", "Не удалось завершить активацию кабинета.");
    }
    await partnerInvitationAttempts.clear(attemptKey);
    const activatedPublicUser = publicUser(activatedUser);
    await rememberNotificationUser(activatedPublicUser);
    await queueNotification("partner_account_activated", () => notifications.enqueueUser(activatedPublicUser, {
      eventKey: "partner_account_activated",
      title: "Кабинет площадки активирован",
      body: `${activated.venueTitle}: заполните описание, добавьте помещения, фотографии и расписание.`,
      dedupeKey: `partner-account-activated|${activatedUser.id}`,
    }));
    if (twoFactor.requiredFor(activatedUser.role)) {
      const challenge = await twoFactor.begin(
        activatedUser,
        request.ip,
        request.headers["user-agent"] ?? null,
      );
      return reply.code(202).send({
        ...challenge,
        venue: { id: activated.venueId, title: activated.venueTitle },
      });
    }
    const session = await auth.issueSessionForUser(
      activatedUser.id,
      request.ip,
      request.headers["user-agent"] ?? null,
      false,
    );
    if (!session) throw new ApiError(500, "PARTNER_ACTIVATION_FAILED", "Не удалось открыть кабинет партнёра.");
    refreshCookie(reply, session.refreshToken, session.refreshExpiresIn, config.secureCookies);
    await queueLoginNotification(session, request.ip, request.headers["user-agent"] ?? null);
    return reply.code(201).send({
      ...authResponse(session),
      venue: { id: activated.venueId, title: activated.venueTitle },
    });
  });

  app.post<{ Body: ClientRegistrationBody }>("/v1/auth/client/register", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["name", "email", "phone", "city", "password", "legal"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 100 },
          email: { type: "string", minLength: 5, maxLength: 254 },
          phone: { type: "string", minLength: 10, maxLength: 30 },
          city: { type: "string", minLength: 2, maxLength: 100 },
          password: { type: "string", minLength: 8, maxLength: 128 },
          legal: {
            type: "object",
            additionalProperties: false,
            required: ["termsVersion", "privacyVersion", "acceptedAt"],
            properties: {
              termsVersion: { type: "string", minLength: 1, maxLength: 100 },
              privacyVersion: { type: "string", minLength: 1, maxLength: 100 },
              acceptedAt: { type: "string", minLength: 20, maxLength: 40 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body;
    const normalizedEmail = email(body.email);
    const normalizedPhone = normalizeRussianPhone(body.phone);
    const acceptedAt = new Date(body.legal.acceptedAt);
    if (!normalizedEmail) throw new ApiError(400, "INVALID_EMAIL", "Проверьте электронную почту.");
    if (!normalizedPhone) throw new ApiError(400, "INVALID_PHONE", "Укажите российский номер телефона.");
    if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new ApiError(400, "INVALID_CONSENT_DATE", "Не удалось подтвердить дату согласия.");
    }
    const session = await auth.register({
      name: body.name.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      city: body.city.trim(),
      password: body.password,
      legal: { ...body.legal, acceptedAt: acceptedAt.toISOString() },
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    await rememberNotificationUser(session.user);
    await queueNotification("client_registered", () => notifications.enqueueUser(session.user, {
      eventKey: "client_registered",
      title: "Добро пожаловать в Rooms",
      body: `${session.user.name}, ваш кабинет создан. Теперь выбранные помещения и заявки будут доступны в одном месте.`,
      dedupeKey: `client-registered|${session.user.id}`,
    }));
    refreshCookie(reply, session.refreshToken, session.refreshExpiresIn, config.secureCookies);
    return reply.code(201).send(authResponse(session));
  });

  app.post<{ Body: LoginBody }>("/v1/auth/login", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["login", "password"],
        properties: {
          login: { type: "string", minLength: 3, maxLength: 254 },
          password: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const login = request.body.login.trim();
    const accountAttemptKey = loginAttemptKey(login);
    const ipAttemptKey = request.ip;
    const [accountBlocked, ipBlocked] = await Promise.all([
      loginAccountAttempts.blocked(accountAttemptKey),
      loginIpAttempts.blocked(ipAttemptKey),
    ]);
    if (accountBlocked || ipBlocked) {
      reply.header("Retry-After", "600");
      throw new ApiError(429, "LOGIN_RATE_LIMITED", "Слишком много попыток. Повторите вход через 10 минут.");
    }
    const user = await auth.verifyCredentials(login, request.body.password);
    if (!user) {
      const [accountFailures] = await Promise.all([
        loginAccountAttempts.fail(accountAttemptKey),
        loginIpAttempts.fail(ipAttemptKey),
      ]);
      if (accountFailures === 5) {
        const target = await config.authRepository.findUserByLogin(login, normalizeRussianPhone(login));
        if (target && target.blockedAt === null) {
          await queueSuspiciousLoginNotification(
            publicUser(target),
            request.ip,
            request.headers["user-agent"] ?? null,
            accountAttemptKey,
          );
        }
      }
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверная почта, телефон или пароль.");
    }
    await loginAccountAttempts.clear(accountAttemptKey);
    if (twoFactor.requiredFor(user.role)) {
      const challenge = await twoFactor.begin(
        user,
        request.ip,
        request.headers["user-agent"] ?? null,
      );
      return reply.code(202).send(challenge);
    }
    const session = await auth.issueSessionForUser(
      user.id,
      request.ip,
      request.headers["user-agent"] ?? null,
      false,
    );
    if (!session) throw new ApiError(500, "SESSION_CREATE_FAILED", "Не удалось открыть кабинет.");
    await rememberNotificationUser(session.user);
    await queueLoginNotification(session, request.ip, request.headers["user-agent"] ?? null);
    refreshCookie(reply, session.refreshToken, session.refreshExpiresIn, config.secureCookies);
    return authResponse(session);
  });

  app.post<{ Body: TwoFactorCompleteBody }>("/v1/auth/2fa/complete", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["challengeToken", "code"],
        properties: {
          challengeToken: { type: "string", minLength: 32, maxLength: 200 },
          code: { type: "string", minLength: 6, maxLength: 24 },
        },
      },
    },
  }, async (request, reply) => {
    const attemptKey = `two-factor|${request.ip}`;
    if (await twoFactorIpAttempts.blocked(attemptKey)) {
      reply.header("Retry-After", "600");
      throw new ApiError(429, "TWO_FACTOR_RATE_LIMITED", "Слишком много попыток. Повторите вход через 10 минут.");
    }
    let completion;
    try {
      completion = await twoFactor.complete(request.body.challengeToken, request.body.code);
    } catch (error) {
      await twoFactorIpAttempts.fail(attemptKey);
      throw error;
    }
    const session = await auth.issueSessionForUser(
      completion.userId,
      request.ip,
      request.headers["user-agent"] ?? null,
      true,
    );
    if (!session) throw new ApiError(401, "ACCOUNT_UNAVAILABLE", "Кабинет недоступен.");
    await twoFactorIpAttempts.clear(attemptKey);
    await rememberNotificationUser(session.user);
    await queueLoginNotification(session, request.ip, request.headers["user-agent"] ?? null);
    refreshCookie(reply, session.refreshToken, session.refreshExpiresIn, config.secureCookies);
    return {
      ...authResponse(session),
      recoveryCodes: completion.recoveryCodes,
      usedRecoveryCode: completion.usedRecoveryCode,
    };
  });

  app.post<{ Body: TwoFactorRecoveryRequestBody }>("/v1/auth/2fa/recovery/request", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["challengeToken"],
        properties: {
          challengeToken: { type: "string", minLength: 32, maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const attemptKey = `two-factor-recovery|${request.ip}`;
    if (await twoFactorRecoveryIpAttempts.blocked(attemptKey)) {
      reply.header("Retry-After", "3600");
      throw new ApiError(
        429,
        "TWO_FACTOR_RECOVERY_RATE_LIMITED",
        "Слишком много запросов восстановления. Повторите через час.",
      );
    }
    await twoFactorRecoveryIpAttempts.fail(attemptKey);
    const record = await twoFactor.requestRecovery(
      request.body.challengeToken,
      request.ip,
      request.headers["user-agent"] ?? null,
    );
    const target = await config.authRepository.findUserById(record.userId);
    if (!target || target.blockedAt !== null || !twoFactor.requiredFor(target.role)) {
      throw new TwoFactorError(
        410,
        "TWO_FACTOR_RECOVERY_UNAVAILABLE",
        "The two-factor recovery request is unavailable.",
      );
    }
    const recipient = publicUser(target);
    await queueNotification("two_factor_recovery_requested", () => notifications.enqueueUser(recipient, {
      eventKey: "two_factor_recovery_requested",
      title: "Запрошено восстановление входа",
      body: `Запрос отправлен с ${deviceLabel(request.headers["user-agent"] ?? null)} · IP ${maskedIp(request.ip)}. До решения администратора вход по старому второму фактору остаётся защищённым.`,
      dedupeKey: `two-factor-recovery-requested|${record.id}`,
    }));
    return reply.code(202).send({
      accepted: true,
      requestId: record.id,
      expiresAt: record.expiresAt,
      expiresIn: twoFactorRecoveryLifetimeSeconds,
    });
  });

  app.post<{ Body: PasswordResetRequestBody }>("/v1/auth/password-reset/request", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["login"],
        properties: { login: { type: "string", minLength: 3, maxLength: 254 } },
      },
    },
  }, async (request, reply) => {
    const login = request.body.login.trim();
    const attemptKey = `password-reset|${request.ip}`;
    if (await passwordResetAttempts.blocked(attemptKey)) {
      throw new ApiError(429, "PASSWORD_RESET_RATE_LIMITED", "Слишком много запросов. Попробуйте снова через 10 минут.");
    }
    await passwordResetAttempts.fail(attemptKey);
    const reset = await auth.requestPasswordReset(login, request.ip, request.headers["user-agent"] ?? null);
    const resetUrl = new URL(config.publicSiteUrl);
    resetUrl.searchParams.set("reset", reset.token);
    if (reset.user) {
      await queueNotification("password_reset_requested", () => notifications.enqueuePasswordReset(reset.user!, resetUrl.toString()));
    }
    const payload: Record<string, unknown> = {
      accepted: true,
      expiresIn: passwordResetLifetimeSeconds,
      message: "Если кабинет найден, ссылка для смены пароля уже отправлена.",
    };
    if (config.exposePasswordResetToken) {
      payload.demoToken = reset.token;
      payload.demoResetUrl = resetUrl.toString();
    }
    return reply.code(202).send(payload);
  });

  app.post<{ Body: PasswordResetConfirmBody }>("/v1/auth/password-reset/confirm", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["token", "newPassword"],
        properties: {
          token: { type: "string", minLength: 32, maxLength: 200 },
          newPassword: { type: "string", minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const attemptKey = `password-reset-confirm|${request.ip}`;
    if (await passwordResetConfirmAttempts.blocked(attemptKey)) {
      throw new ApiError(429, "PASSWORD_RESET_RATE_LIMITED", "Слишком много попыток. Попробуйте снова через 10 минут.");
    }
    const completed = await auth.resetPassword(request.body.token, request.body.newPassword);
    if (!completed) {
      await passwordResetConfirmAttempts.fail(attemptKey);
      throw new ApiError(400, "PASSWORD_RESET_INVALID", "Ссылка устарела или уже была использована.");
    }
    await passwordResetConfirmAttempts.clear(attemptKey);
    clearRefreshCookie(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    const token = cookieValue(request.headers.cookie, "rooms_refresh");
    const session = token ? await auth.refresh(token, request.ip, request.headers["user-agent"] ?? null) : null;
    if (!session) {
      clearRefreshCookie(reply, config.secureCookies);
      throw new ApiError(401, "SESSION_EXPIRED", "Сессия завершена. Войдите снова.");
    }
    await rememberNotificationUser(session.user);
    refreshCookie(reply, session.refreshToken, session.refreshExpiresIn, config.secureCookies);
    return authResponse(session);
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = cookieValue(request.headers.cookie, "rooms_refresh");
    await auth.logout(request.headers.authorization, token);
    clearRefreshCookie(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.get("/v1/me", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    return current.user;
  });

  app.get("/v1/me/two-factor", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    return twoFactor.status(current.user.id, current.user.role);
  });

  app.get("/v1/me/notification-settings", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    await rememberNotificationUser(current.user);
    return notifications.getSettings(current.user);
  });

  app.patch<{ Body: NotificationSettingsBody }>("/v1/me/notification-settings", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["emailEnabled", "telegramEnabled"],
        properties: {
          siteEnabled: { type: "boolean", const: true },
          emailEnabled: { type: "boolean" },
          emailAddress: { type: ["string", "null"], maxLength: 254 },
          telegramEnabled: { type: "boolean" },
          telegramChatId: { type: ["string", "null"], maxLength: 100 },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    const emailValue = request.body.emailAddress?.trim() || (request.body.emailEnabled ? current.user.email ?? "" : "");
    const emailAddress = emailValue ? email(emailValue) : null;
    if (request.body.emailEnabled && !emailAddress) {
      throw new ApiError(400, "NOTIFICATION_EMAIL_REQUIRED", "Укажите корректную почту для уведомлений.");
    }
    const telegramChatId = request.body.telegramChatId?.trim() || null;
    if (request.body.telegramEnabled && (!telegramChatId || !/^(?:-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/u.test(telegramChatId))) {
      throw new ApiError(400, "TELEGRAM_CHAT_REQUIRED", "Укажите числовой chat ID Telegram или имя канала вида @rooms_channel.");
    }
    return notifications.updateSettings(current.user, {
      emailEnabled: request.body.emailEnabled,
      emailAddress,
      telegramEnabled: request.body.telegramEnabled,
      telegramChatId,
    });
  });

  app.post("/v1/me/notification-settings/test", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    const deliveries = await notifications.enqueueTest(current.user, `notification-test|${current.user.id}|${Date.now()}`);
    if (!deliveries.length) throw new ApiError(409, "NOTIFICATION_CHANNELS_DISABLED", "Сначала включите хотя бы один внешний канал.");
    return reply.code(202).send({ accepted: true, deliveries });
  });

  app.get<{ Querystring: NotificationDeliveryQuerystring }>("/v1/me/notification-deliveries", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["queued", "processing", "sent", "failed", "cancelled"] },
          channel: { type: "string", enum: ["email", "telegram"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    const query: NotificationDeliveryQuery = {
      ...(request.query.status ? { status: request.query.status } : {}),
      ...(request.query.channel ? { channel: request.query.channel } : {}),
      limit: request.query.limit ?? 50,
    };
    return notifications.listForUser(current.user.id, query);
  });

  app.get("/v1/me/sessions", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    return { items: await auth.listSessions(current.user.id, current.sessionId) };
  });

  app.delete("/v1/me/sessions/others", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    await auth.revokeOtherUserSessions(current.user.id, current.sessionId);
    return reply.code(204).send();
  });

  app.delete<{ Params: SessionParams }>("/v1/me/sessions/:sessionId", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["sessionId"],
        properties: {
          sessionId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" },
        },
      },
    },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет.");
    const revoked = await auth.revokeUserSession(current.user.id, request.params.sessionId);
    if (!revoked) throw new ApiError(404, "SESSION_NOT_FOUND", "Активная сессия не найдена.");
    if (current.sessionId === request.params.sessionId) clearRefreshCookie(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.patch<{ Body: ClientProfileBody }>("/v1/me", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["name", "email", "phone", "city"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 100 },
          email: { type: "string", minLength: 5, maxLength: 254 },
          phone: { type: "string", minLength: 10, maxLength: 30 },
          city: { type: "string", minLength: 2, maxLength: 100 },
          currentPassword: { type: "string", minLength: 1, maxLength: 128 },
          newPassword: { type: "string", minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    const normalizedEmail = email(request.body.email);
    const normalizedPhone = normalizeRussianPhone(request.body.phone);
    if (!normalizedEmail) throw new ApiError(400, "INVALID_EMAIL", "Проверьте электронную почту.");
    if (!normalizedPhone) throw new ApiError(400, "INVALID_PHONE", "Укажите российский номер телефона.");
    if (request.body.newPassword && !request.body.currentPassword) {
      throw new ApiError(400, "CURRENT_PASSWORD_REQUIRED", "Для смены пароля укажите текущий пароль.");
    }
    const updated = await auth.updateClientProfile(current.user.id, current.sessionId, {
      name: request.body.name.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      city: request.body.city.trim(),
      ...(request.body.currentPassword ? { currentPassword: request.body.currentPassword } : {}),
      ...(request.body.newPassword ? { newPassword: request.body.newPassword } : {}),
    });
    if (!updated) throw new ApiError(401, "CURRENT_PASSWORD_INVALID", "Текущий пароль не подходит.");
    await rememberNotificationUser(updated);
    return updated;
  });

  app.get<{ Querystring: BookingQuery }>("/v1/bookings", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          statusGroup: { type: "string", enum: ["active", "completed", "cancelled", "all"] },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    return config.bookingRepository.listByClient(current.user.id, request.query.statusGroup ?? "all");
  });

  app.get("/v1/me/reviews", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    return config.reviewRepository.listByClient(current.user.id);
  });

  app.get<{ Querystring: SupportQuerystring }>("/v1/me/support", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["open", "working", "closed", "all"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    return config.supportRepository.list(current.user.id, "client", request.query.status ?? "all", request.query.limit ?? 80);
  });

  app.post<{ Params: BookingParams; Body: BookingCancelBody }>("/v1/bookings/:bookingId/cancel", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: { reason: { type: "string", minLength: 3, maxLength: 1000 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    const booking = await config.bookingRepository.cancelByClient(current.user.id, request.params.bookingId, request.body.reason.trim());
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Бронь не найдена в личном кабинете.");
    await queueNotification("booking_cancelled_by_client", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingVenue(booking.id, {
        eventKey: "booking_cancelled_by_client",
        title: `Клиент отменил ${booking.publicNumber}`,
        body: booking.paymentStatus === "refund_pending"
          ? `Бронь отменена после предоплаты. В очереди Rooms создана задача на возврат. Причина: ${booking.cancellationReason}`
          : `Время освобождено. Причина: ${booking.cancellationReason}`,
        dedupeKey: `booking-cancelled-client|${booking.id}`,
      });
    });
    return booking;
  });

  app.get<{ Params: BookingParams }>("/v1/bookings/:bookingId/support", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const actor = await requireSupportActor(request.headers.authorization);
    const records = await config.supportRepository.listByBooking(actor.id, actor.role, request.params.bookingId);
    if (!records) throw new ApiError(404, "BOOKING_NOT_FOUND", "Бронь не найдена или недоступна этому кабинету.");
    return records;
  });

  app.post<{ Params: BookingParams; Body: SupportOpenBody }>("/v1/bookings/:bookingId/support", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "body"],
        properties: {
          topic: { type: "string", minLength: 3, maxLength: 200 },
          body: { type: "string", minLength: 5, maxLength: 3000 },
        },
      },
    },
  }, async (request, reply) => {
    const actor = await requireSupportActor(request.headers.authorization);
    const record = await config.supportRepository.open(
      actor.id,
      actor.role,
      request.params.bookingId,
      request.body.topic.trim(),
      request.body.body.trim(),
    );
    if (!record) throw new ApiError(404, "BOOKING_NOT_FOUND", "Бронь не найдена или недоступна этому кабинету.");
    return reply.code(201).send(record);
  });

  app.post<{ Params: SupportParams; Body: SupportMessageBody }>("/v1/support/:supportId/messages", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["supportId"],
        properties: { supportId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["body"],
        properties: { body: { type: "string", minLength: 5, maxLength: 3000 } },
      },
    },
  }, async (request, reply) => {
    const actor = await requireSupportActor(request.headers.authorization);
    const record = await config.supportRepository.addMessage(actor.id, actor.role, request.params.supportId, request.body.body.trim());
    if (!record) throw new ApiError(404, "SUPPORT_CASE_NOT_FOUND", "Обращение не найдено или недоступно этому кабинету.");
    return reply.code(201).send(record);
  });

  app.post<{ Params: BookingParams }>("/v1/bookings/:bookingId/complete", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    const booking = await config.bookingRepository.completeByClient(current.user.id, request.params.bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в личном кабинете.");
    await queueNotification("booking_completed_by_client", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingVenue(booking.id, {
        eventKey: "booking_completed_by_client",
        title: `Клиент подтвердил посещение ${booking.publicNumber}`,
        body: `Бронь ${booking.publicNumber} завершена клиентом. Отзыв станет доступен после отправки и проверки Rooms.`,
        dedupeKey: `booking-completed-client|${booking.id}`,
      });
    });
    return booking;
  });

  app.post<{ Params: BookingParams; Body: ReviewSubmitBody }>("/v1/bookings/:bookingId/review", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: reviewSubmitBodySchema,
    },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    const review = await config.reviewRepository.submit(current.user.id, current.user.name, request.params.bookingId, {
      roomId: request.body.roomId,
      rating: request.body.rating,
      body: request.body.body.trim(),
    });
    if (!review) throw new ApiError(404, "BOOKING_NOT_FOUND", "Завершённая бронь не найдена в личном кабинете.");
    return reply.code(201).send(review);
  });

  app.get<{ Params: BookingParams }>("/v1/bookings/:bookingId/messages", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || (current.user.role !== "client" && current.user.role !== "partner")) {
      throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет участника заявки.");
    }
    const messages = await config.bookingRepository.listMessages(current.user.id, current.user.role, request.params.bookingId);
    if (!messages) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена или недоступна этому кабинету.");
    return messages;
  });

  app.post<{ Params: BookingParams; Body: BookingMessageBody }>("/v1/bookings/:bookingId/messages", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["body"],
        properties: { body: { type: "string", minLength: 1, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || (current.user.role !== "client" && current.user.role !== "partner")) {
      throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет участника заявки.");
    }
    const booking = current.user.role === "client"
      ? await config.bookingRepository.findByClient(current.user.id, request.params.bookingId)
      : await config.bookingRepository.findByPartner(current.user.id, request.params.bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена или недоступна этому кабинету.");
    const body = request.body.body.trim();
    if (!body) throw new ApiError(400, "MESSAGE_REQUIRED", "Введите сообщение.");
    const blocked = booking.status !== "paid" ? blockedChatContact(body) : null;
    if (blocked) throw new ApiError(422, "CONTACT_DETAILS_BLOCKED", `До предоплаты нельзя передавать ${blocked}.`);
    const message = await config.bookingRepository.addMessage(current.user.id, current.user.role, request.params.bookingId, body);
    if (!message) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена или недоступна этому кабинету.");
    await queueNotification("booking_message_created", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      const event = {
        eventKey: "booking_message_created",
        title: `Новое сообщение по заявке ${booking.publicNumber}`,
        body: `${current.user.role === "client" ? "Клиент" : booking.venue.title} отправил новое сообщение. Откройте заявку в кабинете Rooms, чтобы ответить.`,
        dedupeKey: `booking-message|${message.id}`,
      };
      if (current.user.role === "client") await notifications.enqueueBookingVenue(booking.id, event);
      else await notifications.enqueueBookingClient(booking.id, event);
    });
    return reply.code(201).send(message);
  });

  app.post<{ Params: BookingParams; Body: BookingProposalActionBody }>("/v1/bookings/:bookingId/proposal/accept", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["proposalId"],
        properties: { proposalId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    const booking = await config.bookingRepository.acceptProposalByClient(current.user.id, request.params.bookingId, request.body.proposalId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в личном кабинете.");
    await queueNotification("booking_proposal_accepted", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingVenue(booking.id, {
        eventKey: "booking_proposal_accepted",
        title: `Клиент принял новое время ${booking.publicNumber}`,
        body: `Предложенное время принято. Заявка ${booking.publicNumber} ожидает подтверждения и предоплаты.`,
        dedupeKey: `proposal-accepted|${request.body.proposalId}`,
      });
    });
    return booking;
  });

  app.post<{ Params: BookingParams; Body: BookingProposalActionBody }>("/v1/bookings/:bookingId/proposal/decline", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["proposalId"],
        properties: { proposalId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    const booking = await config.bookingRepository.declineProposalByClient(current.user.id, request.params.bookingId, request.body.proposalId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в личном кабинете.");
    await queueNotification("booking_proposal_declined", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingVenue(booking.id, {
        eventKey: "booking_proposal_declined",
        title: `Клиент отклонил новое время ${booking.publicNumber}`,
        body: `Клиент не принял предложенное время. Откройте заявку ${booking.publicNumber}, чтобы согласовать другой вариант.`,
        dedupeKey: `proposal-declined|${request.body.proposalId}`,
      });
    });
    return booking;
  });

  app.post<{ Body: BookingCreateBody }>("/v1/bookings", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["primaryRoomId", "roomIds", "startsAt", "durationMinutes", "guests", "legal"],
        properties: {
          primaryRoomId: { type: "string", minLength: 1, maxLength: 100 },
          roomIds: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
          startsAt: { type: "string", minLength: 20, maxLength: 40 },
          durationMinutes: { type: "integer", minimum: 30, maximum: 1440, multipleOf: 30 },
          guests: { type: "integer", minimum: 1, maximum: 1000 },
          eventType: { type: ["string", "null"], maxLength: 100 },
          eventName: { type: ["string", "null"], maxLength: 200 },
          serviceIds: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
          onSitePaymentMethod: { type: "string", enum: ["card", "cash"] },
          comment: { type: "string", maxLength: 2000 },
          legal: {
            type: "object",
            additionalProperties: false,
            required: ["termsVersion", "privacyVersion", "acceptedAt"],
            properties: {
              termsVersion: { type: "string", minLength: 1, maxLength: 100 },
              privacyVersion: { type: "string", minLength: 1, maxLength: 100 },
              acceptedAt: { type: "string", minLength: 20, maxLength: 40 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    if (!current.user.phone) throw new ApiError(400, "CLIENT_PHONE_REQUIRED", "Добавьте телефон в личном кабинете перед бронированием.");
    const body = request.body;
    if (!body.roomIds.includes(body.primaryRoomId)) throw new ApiError(400, "PRIMARY_ROOM_REQUIRED", "Основное помещение должно входить в состав брони.");
    const startsAt = new Date(body.startsAt);
    if (!Number.isFinite(startsAt.getTime())) throw new ApiError(400, "INVALID_START", "Проверьте дату и время начала.");
    if (startsAt.getTime() < Date.now()) throw new ApiError(400, "START_IN_PAST", "Нельзя создать заявку на прошедшее время.");
    const acceptedAt = new Date(body.legal.acceptedAt);
    if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new ApiError(400, "INVALID_CONSENT_DATE", "Не удалось подтвердить дату согласия.");
    }
    const localStart = moscowDateTime(startsAt);
    const found = await Promise.all(body.roomIds.map((id) => config.repository.findRoom(id, localStart.date)));
    if (found.some((room) => room === null)) throw new ApiError(404, "ROOM_NOT_FOUND", "Одно из помещений не найдено или временно скрыто.");
    const selectedRooms = await withReservationBlocks(found as Room[], localStart.date);
    const venueIds = new Set(selectedRooms.map((room) => room.venueId));
    if (venueIds.size !== 1) throw new ApiError(400, "VENUE_MISMATCH", "В одной заявке можно выбрать помещения только одной площадки.");
    if (body.durationMinutes < Math.max(...selectedRooms.map((room) => room.minimumHours * 60))) {
      throw new ApiError(400, "MINIMUM_DURATION", "Выбранная длительность меньше минимальной для одного из помещений.");
    }
    const capacity = selectedRooms.reduce((sum, room) => sum + room.capacityMax, 0);
    if (body.guests > capacity) throw new ApiError(400, "CAPACITY_EXCEEDED", `Для выбранных помещений доступно до ${capacity} гостей.`);
    const windows = intersectAvailability(
      selectedRooms.map((room) => availabilityForRoom(room, localStart.date, body.durationMinutes, localStart.time)),
      body.durationMinutes,
      localStart.time,
    );
    const selectedWindow = windows.find((window) => new Date(window.startsAt).getTime() === startsAt.getTime());
    if (!selectedWindow) throw new ApiError(409, "SLOT_UNAVAILABLE", "Выбранное время уже недоступно. Выберите другое окно.", windows.slice(0, 6));
    const venue = await config.repository.findVenue(selectedRooms[0]!.venueId);
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Площадка не найдена или временно скрыта.");
    const method = body.onSitePaymentMethod ?? venue.paymentMethods[0] ?? "card";
    if (!venue.paymentMethods.includes(method)) throw new ApiError(400, "PAYMENT_METHOD_UNAVAILABLE", "Площадка не поддерживает выбранный способ оплаты остатка.");
    const serviceIds = body.serviceIds ?? [];
    const availableServices = new Map(selectedRooms.flatMap((room) => room.services.map((service) => [service.id, service] as const)));
    const unknownService = serviceIds.find((id) => !availableServices.has(id));
    if (unknownService) throw new ApiError(400, "SERVICE_NOT_FOUND", "Одна из дополнительных услуг больше недоступна.");
    const bookingRooms = selectedRooms.map((room) => ({
      id: room.id,
      slug: room.slug,
      title: room.title,
      type: room.type,
      capacityMax: room.capacityMax,
      pricePerHour: room.pricePerHour,
      amount: moneyAmount(roomPriceForBooking(room, localStart.date, selectedWindow.startsAt, body.durationMinutes)),
      isPrimary: room.id === body.primaryRoomId,
      bufferMinutes: room.bufferMinutes,
    }));
    const bookingServices = serviceIds.map((id) => {
      const service = availableServices.get(id)!;
      return { id: service.id, name: service.name, description: service.description, price: service.price, quantity: 1, amount: service.price };
    });
    const roomTotal = moneyAmount(bookingRooms.reduce((sum, room) => sum + room.amount, 0));
    const serviceTotal = moneyAmount(bookingServices.reduce((sum, service) => sum + service.amount, 0));
    const total = moneyAmount(roomTotal + serviceTotal);
    const prepayment = Math.ceil(total * 0.3);
    const commission = Math.ceil(total * 0.15);
    const endsAt = new Date(startsAt.getTime() + body.durationMinutes * 60 * 1000).toISOString();
    const booking = await config.bookingRepository.create({
      clientId: current.user.id,
      clientName: current.user.name,
      clientPhone: current.user.phone,
      clientEmail: current.user.email,
      venue,
      rooms: bookingRooms,
      services: bookingServices,
      startsAt: startsAt.toISOString(),
      endsAt,
      guests: body.guests,
      eventType: body.eventType?.trim() || null,
      eventName: body.eventName?.trim() || null,
      onSitePaymentMethod: method,
      comment: body.comment?.trim() ?? "",
      money: { roomTotal, serviceTotal, total, prepayment, remainingOnSite: moneyAmount(total - prepayment), currency: "RUB" },
      commission,
      partnerAmount: moneyAmount(prepayment - commission),
      legal: { ...body.legal, acceptedAt: acceptedAt.toISOString() },
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    await queueNotification("booking_created", async () => {
      await notifications.rememberUser(current.user);
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingVenue(booking.id, {
        eventKey: "booking_created",
        title: `Новая заявка ${booking.publicNumber}`,
        body: `${booking.clientName} выбрал ${booking.rooms.map((room) => room.title).join(", ")}. Проверьте время и ответьте клиенту в кабинете Rooms.`,
        dedupeKey: `booking-created|${booking.id}|venue`,
      });
      await notifications.enqueueBookingClient(booking.id, {
        eventKey: "booking_created",
        title: `Заявка ${booking.publicNumber} отправлена`,
        body: `${booking.venue.title} получил заявку. Мы сообщим, когда площадка подтвердит время.`,
        dedupeKey: `booking-created|${booking.id}|client`,
      });
    });
    return reply.code(201).send(booking);
  });

  app.post<{ Params: BookingParams }>("/v1/bookings/:bookingId/payment-intent", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    if (config.paymentRepository.provider === "rooms_demo" && !config.enableDemoPayments) {
      throw new ApiError(503, "PAYMENTS_NOT_CONFIGURED", "Онлайн-оплата временно недоступна.");
    }
    const payment = await config.paymentRepository.createIntent(current.user.id, request.params.bookingId);
    return reply.code(201).send(payment);
  });

  app.post<{ Params: PaymentParams }>("/v1/payments/:paymentId/demo-complete", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["paymentId"],
        properties: { paymentId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "client") throw new ApiError(401, "UNAUTHORIZED", "Войдите в личный кабинет клиента.");
    if (config.paymentRepository.provider !== "rooms_demo" || !config.enableDemoPayments) {
      throw new ApiError(404, "DEMO_PAYMENTS_DISABLED", "Демонстрационный платёжный маршрут отключён.");
    }
    const payment = await config.paymentRepository.completeDemo(current.user.id, request.params.paymentId);
    const booking = (await config.bookingRepository.listByClient(current.user.id, "all")).find((item) => item.id === payment.bookingId);
    if (!booking) throw new ApiError(409, "BOOKING_STATE_CHANGED", "Статус брони изменился. Обновите личный кабинет.");
    await queuePaymentPaidNotifications(payment, booking);
    return { payment, booking };
  });

  app.post<{ Body: SberWebhookBody }>("/v1/payments/webhooks/sber", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["mdOrder", "orderNumber", "operation", "status"],
        properties: {
          mdOrder: { type: "string", minLength: 36, maxLength: 36 },
          orderNumber: { type: "string", minLength: 1, maxLength: 36 },
          operation: {
            type: "string",
            enum: ["created", "approved", "deposited", "reversed", "refunded", "declinedByTimeout", "subscriptionCreated"],
          },
          status: { type: "integer", minimum: 0, maximum: 1 },
          additionalParams: { type: "object", additionalProperties: true },
        },
      },
    },
  }, async (request) => {
    const result = await config.paymentRepository.processProviderCallback("sber", request.body);
    const booking = (await config.bookingRepository.listByAdmin("all")).find((item) => item.id === result.bookingId);
    if (booking && (result.outcome === "paid" || result.outcome === "already_paid")) {
      await queuePaymentPaidNotifications(result.payment, booking);
    }
    if (booking && result.outcome === "refund_pending") {
      await queueNotification("late_payment_refund", async () => {
        await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
        await notifications.enqueueBookingClient(booking.id, {
          eventKey: "late_payment_refund",
          title: `Оплата по заявке ${booking.publicNumber} поступила после освобождения времени`,
          body: `Слот уже был освобождён. Возврат ${result.payment.amount.toLocaleString("ru-RU")} руб. поставлен в очередь.`,
          dedupeKey: `late-payment-refund|${result.payment.paymentId}|client`,
        });
      });
    }
    return { status: "ok" };
  });

  app.get("/v1/partner/bank-account", async (request) => {
    const { actorId } = await requirePartnerVenue(request.headers.authorization);
    const account = await config.financeRepository.getPartnerBankAccount(actorId);
    if (!account) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Для этого кабинета площадка ещё не назначена.");
    return account;
  });

  app.put<{ Body: PartnerBankAccountBody }>("/v1/partner/bank-account", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["bankName", "bik", "settlementAccount"],
        properties: {
          bankName: { type: "string", minLength: 2, maxLength: 150 },
          bik: { type: "string", pattern: "^[0-9]{9}$" },
          settlementAccount: { type: "string", pattern: "^[0-9]{20}$" },
        },
      },
    },
  }, async (request) => {
    const { actorId } = await requirePartnerVenue(request.headers.authorization);
    const account = await config.financeRepository.updatePartnerBankAccount(actorId, {
      bankName: request.body.bankName.trim(),
      bik: request.body.bik,
      settlementAccount: request.body.settlementAccount,
    });
    if (!account) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Для этого кабинета площадка ещё не назначена.");
    return account;
  });

  app.get<{ Querystring: AccountingListQuerystring }>("/v1/partner/payouts", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["draft", "sent", "paid", "cancelled", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    const { actorId } = await requirePartnerVenue(request.headers.authorization);
    return config.financeRepository.listPayouts(
      actorId,
      "partner",
      (request.query.status ?? "all") as FinancePayoutQueryStatus,
      request.query.limit ?? 80,
    );
  });

  app.get("/v1/accounting/overview", async (request) => {
    await requireFinanceActor(request.headers.authorization);
    return config.financeRepository.overview();
  });

  app.get<{ Querystring: AccountingListQuerystring }>("/v1/accounting/receipts", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["queued", "processing", "succeeded", "failed", "cancelled", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    await requireFinanceActor(request.headers.authorization);
    return config.financeRepository.listReceipts(
      (request.query.status ?? "all") as FiscalReceiptQueryStatus,
      request.query.limit ?? 80,
    );
  });

  app.post<{ Params: ReceiptParams }>("/v1/accounting/receipts/:receiptId/retry", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["receiptId"],
        properties: { receiptId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request, reply) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const result = await config.receiptRepository.retry(request.params.receiptId, actor.id, actor.role);
    if (result.outcome === "not_found") throw new ApiError(404, "FISCAL_RECEIPT_NOT_FOUND", "Чек не найден.");
    if (result.outcome === "state_conflict") {
      throw new ApiError(409, "FISCAL_RECEIPT_STATE_CHANGED", "Повторить можно только ошибочный или отменённый чек.");
    }
    return reply.code(202).send({ id: request.params.receiptId, status: result.status });
  });

  app.post<{ Params: ReceiptParams }>("/v1/accounting/receipts/:receiptId/cancel", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["receiptId"],
        properties: { receiptId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const result = await config.receiptRepository.cancel(request.params.receiptId, actor.id, actor.role);
    if (result.outcome === "not_found") throw new ApiError(404, "FISCAL_RECEIPT_NOT_FOUND", "Чек не найден.");
    if (result.outcome === "state_conflict") {
      throw new ApiError(409, "FISCAL_RECEIPT_STATE_CHANGED", "Отменить можно только чек в очереди или с ошибкой.");
    }
    return { id: request.params.receiptId, status: result.status };
  });

  app.get<{ Querystring: AccountingListQuerystring }>("/v1/accounting/bank-accounts", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["pending", "verified", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    await requireFinanceActor(request.headers.authorization);
    return config.financeRepository.listBankAccounts(
      (request.query.status ?? "all") as BankAccountQueryStatus,
      request.query.limit ?? 80,
    );
  });

  app.post<{ Params: VenueFinanceParams }>("/v1/accounting/bank-accounts/:venueId/verify", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["venueId"],
        properties: { venueId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const account = await config.financeRepository.verifyBankAccount(actor.id, actor.role, request.params.venueId);
    if (!account) throw new ApiError(404, "BANK_ACCOUNT_NOT_FOUND", "Реквизиты площадки не найдены.");
    return account;
  });

  app.get<{ Querystring: AccountingListQuerystring }>("/v1/accounting/refunds", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["refund_pending", "refunded", "failed", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    await requireFinanceActor(request.headers.authorization);
    return config.financeRepository.listRefunds(
      (request.query.status ?? "all") as FinanceRefundQueryStatus,
      request.query.limit ?? 80,
    );
  });

  app.post<{ Params: RefundParams }>("/v1/accounting/refunds/:refundId/retry", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["refundId"],
        properties: { refundId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request, reply) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const result = await config.refundRepository.retry(request.params.refundId, actor.id, actor.role);
    if (result.outcome === "not_found") throw new ApiError(404, "REFUND_NOT_FOUND", "Возврат не найден.");
    if (result.outcome === "state_conflict") {
      throw new ApiError(409, "REFUND_STATE_CHANGED", "Повторить можно только возврат со статусом ошибки.");
    }
    return reply.code(202).send({ id: request.params.refundId, status: result.status });
  });

  app.post<{ Params: RefundParams; Body: ProviderOperationBody }>("/v1/accounting/refunds/:refundId/complete", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["refundId"],
        properties: { refundId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        properties: { providerOperationId: { type: "string", minLength: 3, maxLength: 200 } },
      },
    },
  }, async (request) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const refund = await config.financeRepository.completeRefund(
      actor.id,
      actor.role,
      request.params.refundId,
      request.body?.providerOperationId,
    );
    if (!refund) throw new ApiError(404, "REFUND_NOT_FOUND", "Возврат не найден.");
    await queueNotification("refund_completed", async () => {
      await notifications.enqueueBookingClient(refund.bookingId, {
        eventKey: "refund_completed",
        title: `Возврат по заявке ${refund.publicNumber} выполнен`,
        body: `Возвращено ${refund.amount.toLocaleString("ru-RU")} руб. Срок зачисления зависит от банка клиента.`,
        dedupeKey: `refund-completed|${refund.id}|${refund.completedAt}`,
      });
    });
    return refund;
  });

  app.get("/v1/accounting/payout-candidates", async (request) => {
    await requireFinanceActor(request.headers.authorization);
    return config.financeRepository.listPayoutCandidates();
  });

  app.get<{ Querystring: AccountingListQuerystring }>("/v1/accounting/payouts", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["draft", "sent", "paid", "cancelled", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    return config.financeRepository.listPayouts(
      actor.id,
      actor.role,
      (request.query.status ?? "all") as FinancePayoutQueryStatus,
      request.query.limit ?? 80,
    );
  });

  app.post<{ Body: CreatePayoutsBody }>("/v1/accounting/payouts", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          bookingIds: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            uniqueItems: true,
            items: { type: "string", minLength: 36, maxLength: 36 },
          },
          scheduledFor: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
        },
      },
    },
  }, async (request, reply) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const scheduledFor = request.body?.scheduledFor;
    if (scheduledFor && !isIsoDate(scheduledFor)) throw new ApiError(400, "INVALID_DATE", "Дата выплаты должна существовать.");
    const payouts = await config.financeRepository.createPayouts(actor.id, actor.role, request.body?.bookingIds, scheduledFor);
    await Promise.all(payouts.map((payout) => queueNotification("payout_sent", () => notifications.enqueueVenue(payout.venueId, {
      eventKey: "payout_sent",
      title: `Выплата ${payout.amount.toLocaleString("ru-RU")} руб. направлена`,
      body: `В выплату вошло бронирований: ${payout.items.length}. Статус можно отслеживать в кабинете партнёра.`,
      dedupeKey: `payout-sent|${payout.id}`,
    }))));
    return reply.code(201).send(payouts);
  });

  app.post<{ Params: PayoutParams; Body: ProviderOperationBody }>("/v1/accounting/payouts/:payoutId/complete", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["payoutId"],
        properties: { payoutId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        properties: { providerOperationId: { type: "string", minLength: 3, maxLength: 200 } },
      },
    },
  }, async (request) => {
    const actor = await requireFinanceActor(request.headers.authorization);
    const payout = await config.financeRepository.completePayout(
      actor.id,
      actor.role,
      request.params.payoutId,
      request.body?.providerOperationId,
    );
    if (!payout) throw new ApiError(404, "PAYOUT_NOT_FOUND", "Выплата не найдена.");
    await queueNotification("payout_completed", () => notifications.enqueueVenue(payout.venueId, {
      eventKey: "payout_completed",
      title: `Выплата ${payout.amount.toLocaleString("ru-RU")} руб. выполнена`,
      body: `Средства направлены на расчётный счёт •••• ${payout.accountLastFour ?? "не указан"}.`,
      dedupeKey: `payout-completed|${payout.id}|${payout.paidAt}`,
    }));
    return payout;
  });

  app.get<{ Querystring: TwoFactorRecoveryQuerystring }>("/v1/admin/two-factor-recovery", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["pending", "approved", "rejected", "expired", "all"] },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request.headers.authorization);
    const records = await twoFactor.listRecoveryRequests(
      request.query.status ?? "all",
      request.query.limit ?? 80,
    );
    return reply.header("Cache-Control", "no-store").send(await Promise.all(records.map(publicRecoveryRecord)));
  });

  app.patch<{ Params: TwoFactorRecoveryParams; Body: TwoFactorRecoveryDecisionBody }>(
    "/v1/admin/two-factor-recovery/:recoveryId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["recoveryId"],
          properties: {
            recoveryId: {
              type: "string",
              pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
            },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["approved", "rejected"] },
            comment: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = await requireAdmin(request.headers.authorization);
      const current = await twoFactor.getRecoveryRequest(request.params.recoveryId);
      if (!current) throw new ApiError(404, "TWO_FACTOR_RECOVERY_NOT_FOUND", "Запрос восстановления не найден.");
      if (current.userId === admin.id) {
        throw new ApiError(
          403,
          "TWO_FACTOR_RECOVERY_SELF_APPROVAL_FORBIDDEN",
          "Администратор не может одобрить восстановление собственного доступа.",
        );
      }
      if (current.status !== "pending") {
        throw new ApiError(409, "TWO_FACTOR_RECOVERY_ALREADY_DECIDED", "По запросу уже принято решение или срок истёк.");
      }
      const target = await config.authRepository.findUserById(current.userId);
      if (!target || target.blockedAt !== null || !twoFactor.requiredFor(target.role)) {
        throw new ApiError(409, "TWO_FACTOR_RECOVERY_TARGET_UNAVAILABLE", "Кабинет больше не подходит для восстановления.");
      }
      const comment = request.body.comment?.trim() ?? "";
      if (request.body.status === "rejected" && comment.length < 5) {
        throw new ApiError(400, "TWO_FACTOR_RECOVERY_COMMENT_REQUIRED", "Укажите причину отклонения.");
      }
      const result = await twoFactor.decideRecoveryRequest(
        current.id,
        admin.id,
        request.body.status,
        comment,
      );
      if (!result || result.record.status === "expired") {
        throw new ApiError(409, "TWO_FACTOR_RECOVERY_ALREADY_DECIDED", "Запрос уже обработан или срок его действия истёк.");
      }
      if (result.factorReset) {
        await auth.revokeAllUserSessions(target.id, result.record.reviewedAt ?? result.record.updatedAt);
      }
      const recipient = publicUser(target);
      await queueNotification("two_factor_recovery_decided", () => notifications.enqueueUser(recipient, {
        eventKey: "two_factor_recovery_decided",
        title: result.factorReset ? "Восстановление входа одобрено" : "Восстановление входа отклонено",
        body: result.factorReset
          ? "Все активные сессии завершены. Войдите с паролем и заново привяжите приложение-аутентификатор."
          : `Второй фактор не изменён.${comment ? ` Причина: ${comment}` : ""}`,
        dedupeKey: `two-factor-recovery-decided|${result.record.id}|${result.record.status}`,
      }));
      return reply.header("Cache-Control", "no-store").send(await publicRecoveryRecord(result.record));
    },
  );

  app.get<{ Querystring: AdminPartnerLeadQuerystring }>("/v1/admin/partner-leads", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["new", "review", "approved", "rejected", "all"] },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request.headers.authorization);
    const records = await config.partnerLeadRepository.list(request.query.status ?? "all", request.query.limit ?? 80);
    const invitations = await config.partnerInvitationRepository.latestForLeads(records.map((record) => record.id));
    const invitationsByLead = new Map(invitations.map((invitation) => [invitation.leadId, invitation]));
    return reply.header("Cache-Control", "no-store").send(records.map((record) => ({
      ...record,
      invitation: invitationsByLead.get(record.id) ?? null,
    })));
  });

  app.patch<{ Params: AdminPartnerLeadParams; Body: AdminPartnerLeadDecisionBody }>("/v1/admin/partner-leads/:leadId", {
    schema: {
      params: adminPartnerLeadParamsSchema,
      body: adminPartnerLeadDecisionSchema,
    },
  }, async (request, reply) => {
    const admin = await requireAdmin(request.headers.authorization);
    const comment = request.body.comment?.trim() ?? "";
    if (request.body.status === "rejected" && comment.length < 3) {
      throw new ApiError(400, "PARTNER_LEAD_REJECTION_REASON_REQUIRED", "Укажите причину отклонения заявки.");
    }
    const record = await config.partnerLeadRepository.decide(admin.id, request.params.leadId, request.body.status, comment);
    if (!record) throw new ApiError(404, "PARTNER_LEAD_NOT_FOUND", "Заявка площадки не найдена.");
    return reply.header("Cache-Control", "no-store").send(record);
  });

  app.post<{ Params: AdminPartnerLeadParams }>("/v1/admin/partner-leads/:leadId/invitations", {
    schema: { params: adminPartnerLeadParamsSchema },
  }, async (request, reply) => {
    const admin = await requireAdmin(request.headers.authorization);
    const lead = await config.partnerLeadRepository.findById(request.params.leadId);
    if (!lead) throw new ApiError(404, "PARTNER_LEAD_NOT_FOUND", "Заявка площадки не найдена.");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + partnerInvitationLifetimeSeconds * 1000).toISOString();
    const invitation = await config.partnerInvitationRepository.issue(
      admin.id,
      request.params.leadId,
      createHash("sha256").update(token).digest("hex"),
      expiresAt,
    );
    if (!invitation) throw new ApiError(404, "PARTNER_LEAD_NOT_FOUND", "Заявка площадки не найдена.");
    const requestSiteUrl = `${request.protocol}://${request.headers.host ?? "127.0.0.1"}`;
    const activationSiteUrl = config.productionMode ? config.publicSiteUrl : requestSiteUrl;
    const baseUrl = new URL(activationSiteUrl.endsWith("/") ? activationSiteUrl : `${activationSiteUrl}/`);
    baseUrl.hash = `partner-invite=${token}`;
    let delivery: PublicNotificationDelivery | null = null;
    try {
      const deliveries = await notifications.enqueuePartnerInvitation({
        invitationId: invitation.id,
        contactName: lead.contactName,
        contactEmail: lead.contactEmail,
        venueTitle: lead.venueTitle,
        activationUrl: baseUrl.toString(),
        expiresAt: invitation.expiresAt,
      });
      delivery = deliveries[0] ?? null;
    } catch (error) {
      app.log.error({ err: error, notificationEvent: "partner_invitation_created" }, "could not enqueue Rooms notification");
    }
    return reply.header("Cache-Control", "no-store").code(201).send({
      invitationId: invitation.id,
      activationUrl: baseUrl.toString(),
      expiresAt: invitation.expiresAt,
      delivery,
    });
  });

  app.get<{ Querystring: BookingQuery }>("/v1/admin/bookings", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          statusGroup: { type: "string", enum: ["active", "completed", "cancelled", "all"] },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request.headers.authorization);
    return config.bookingRepository.listByAdmin(request.query.statusGroup ?? "all");
  });

  app.post<{ Params: BookingParams; Body: BookingCancelBody }>("/v1/admin/bookings/:bookingId/cancel", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: { reason: { type: "string", minLength: 3, maxLength: 1000 } },
      },
    },
  }, async (request) => {
    const admin = await requireAdmin(request.headers.authorization);
    const booking = await config.bookingRepository.cancelByAdmin(admin.id, request.params.bookingId, request.body.reason.trim());
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Бронь не найдена в очереди Rooms.");
    await queueNotification("booking_cancelled_by_admin", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      const event = {
        eventKey: "booking_cancelled_by_admin",
        title: `Rooms отменил ${booking.publicNumber}`,
        body: `Причина: ${booking.cancellationReason}`,
        dedupeKey: `booking-cancelled-admin|${booking.id}`,
      };
      await Promise.all([
        notifications.enqueueBookingClient(booking.id, event),
        notifications.enqueueBookingVenue(booking.id, event),
      ]);
    });
    return booking;
  });

  app.get<{ Querystring: SupportQuerystring }>("/v1/admin/support", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["open", "working", "closed", "all"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    const admin = await requireAdmin(request.headers.authorization);
    return config.supportRepository.list(admin.id, "admin", request.query.status ?? "all", request.query.limit ?? 80);
  });

  app.patch<{ Params: SupportParams; Body: SupportStatusBody }>("/v1/admin/support/:supportId", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["supportId"],
        properties: { supportId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: { type: "string", enum: ["open", "working", "closed"] } },
      },
    },
  }, async (request) => {
    const admin = await requireAdmin(request.headers.authorization);
    const record = await config.supportRepository.setStatus(admin.id, request.params.supportId, request.body.status);
    if (!record) throw new ApiError(404, "SUPPORT_CASE_NOT_FOUND", "Обращение не найдено.");
    return record;
  });

  app.get<{ Querystring: NotificationDeliveryQuerystring }>("/v1/admin/notification-deliveries", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["queued", "processing", "sent", "failed", "cancelled"] },
          channel: { type: "string", enum: ["email", "telegram"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request.headers.authorization);
    const query: NotificationDeliveryQuery = {
      ...(request.query.status ? { status: request.query.status } : {}),
      ...(request.query.channel ? { channel: request.query.channel } : {}),
      limit: request.query.limit ?? 80,
    };
    return notifications.listAll(query);
  });

  app.get("/v1/admin/operations/health", async (request, reply) => {
    await requireAdmin(request.headers.authorization);
    const notificationStatuses: readonly NotificationDeliveryStatus[] = ["queued", "processing", "sent", "failed", "cancelled"];
    const [finance, receipts, refunds, ...notificationGroups] = await Promise.all([
      config.financeRepository.overview(),
      config.financeRepository.listReceipts("all", 200),
      config.financeRepository.listRefunds("all", 200),
      ...notificationStatuses.map((status) => config.notificationRepository.listAll({ status, limit: 200 })),
    ]);
    const notificationsByStatus = Object.fromEntries(notificationStatuses.map((status, index) => [
      status,
      notificationGroups[index]?.length ?? 0,
    ])) as Record<NotificationDeliveryStatus, number>;
    const receiptsByStatus = Object.fromEntries(["queued", "processing", "succeeded", "failed", "cancelled"].map((status) => [
      status,
      receipts.filter((item) => item.status === status).length,
    ]));
    const refundsByStatus = Object.fromEntries(["refund_pending", "refunded", "failed"].map((status) => [
      status,
      refunds.filter((item) => item.status === status).length,
    ]));
    let backup: { status: "not_configured" | "missing" | "fresh" | "stale"; createdAt: string | null; ageHours: number | null; sizeBytes: number | null } = {
      status: config.backupStatusFile ? "missing" : "not_configured",
      createdAt: null,
      ageHours: null,
      sizeBytes: null,
    };
    if (config.backupStatusFile) {
      try {
        const metadata = JSON.parse(await readFile(config.backupStatusFile, "utf8")) as { createdAt?: string; sizeBytes?: number };
        const createdAtMs = new Date(metadata.createdAt ?? "").getTime();
        if (!Number.isNaN(createdAtMs)) {
          const ageHours = Math.max(0, (Date.now() - createdAtMs) / (60 * 60 * 1000));
          backup = {
            status: ageHours <= 26 ? "fresh" : "stale",
            createdAt: new Date(createdAtMs).toISOString(),
            ageHours: Math.round(ageHours * 10) / 10,
            sizeBytes: Number.isFinite(metadata.sizeBytes) ? Number(metadata.sizeBytes) : null,
          };
        }
      } catch { /* A missing or invalid status file is reported without exposing filesystem details. */ }
    }
    const warnings: string[] = [];
    if (config.repository.storage !== "postgresql") warnings.push("Каталог работает без PostgreSQL.");
    if (config.notificationRepository.storage !== "postgresql") warnings.push("Очередь уведомлений хранится только в памяти процесса.");
    if (config.financeRepository.storage !== "postgresql") warnings.push("Финансовые операции хранятся только в памяти процесса.");
    if (config.photoStorage.storage !== "s3") warnings.push("Фотографии не подключены к объектному хранилищу.");
    if (config.enableDemoPayments) warnings.push("Используется демонстрационный платёжный адаптер.");
    if (backup.status === "missing") warnings.push("Резервная копия PostgreSQL ещё не зарегистрирована.");
    if (backup.status === "stale") warnings.push("Последняя резервная копия PostgreSQL старше 26 часов.");
    if (notificationsByStatus.failed > 0) warnings.push(`Не доставлено уведомлений: ${notificationsByStatus.failed}.`);
    if ((receiptsByStatus.failed ?? 0) > 0) warnings.push(`Фискальных чеков с ошибкой: ${receiptsByStatus.failed}.`);
    if ((refundsByStatus.failed ?? 0) > 0) warnings.push(`Возвратов с ошибкой: ${refundsByStatus.failed}.`);
    reply.header("Cache-Control", "no-store");
    return {
      status: warnings.length ? "attention" : "ready",
      checkedAt: new Date().toISOString(),
      startedAt: new Date(operationsStartedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - operationsStartedAt) / 1000),
      dependencies: {
        database: config.repository.storage,
        notifications: config.notificationRepository.storage,
        finance: config.financeRepository.storage,
        media: config.photoStorage.storage,
        payments: config.enableDemoPayments ? "demo" : "provider",
      },
      requests: {
        total: requestMetrics.total,
        inFlight: requestMetrics.inFlight,
        averageDurationMs: requestMetrics.total ? Math.round(requestMetrics.durationTotalMs / requestMetrics.total) : 0,
        maxDurationMs: requestMetrics.durationMaxMs,
        slowRequests: requestMetrics.slow,
        byStatus: requestMetrics.byStatus,
        lastError: requestMetrics.lastError,
      },
      queues: {
        notifications: notificationsByStatus,
        receipts: receiptsByStatus,
        refunds: refundsByStatus,
        sampledUpTo: 200,
      },
      backup,
      finance,
      warnings,
    };
  });

  app.get<{ Querystring: ReviewQuerystring }>("/v1/admin/reviews", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["pending", "approved", "rejected", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request.headers.authorization);
    return config.reviewRepository.listAdmin(request.query.status ?? "all", request.query.limit ?? 80);
  });

  app.patch<{ Params: ReviewParams; Body: ReviewDecisionBody }>("/v1/admin/reviews/:reviewId", {
    schema: {
      params: reviewParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["pending", "approved", "rejected"] },
          comment: { type: "string", maxLength: 1000 },
        },
      },
    },
  }, async (request) => {
    const admin = await requireAdmin(request.headers.authorization);
    const comment = request.body.comment?.trim() ?? "";
    if (request.body.status === "rejected" && comment.length < 5) {
      throw new ApiError(400, "REVIEW_COMMENT_REQUIRED", "Укажите причину отклонения отзыва.");
    }
    const review = await config.reviewRepository.decide(request.params.reviewId, admin.id, request.body.status, comment);
    if (!review) throw new ApiError(404, "REVIEW_NOT_FOUND", "Отзыв не найден.");
    await queueNotification("review_moderated", async () => {
      await notifications.enqueueBookingClient(review.bookingId, {
        eventKey: "review_moderated",
        title: request.body.status === "approved" ? "Отзыв опубликован" : request.body.status === "rejected" ? "Отзыв нужно изменить" : "Отзыв возвращён на проверку",
        body: request.body.status === "approved"
          ? `Отзыв о «${review.roomTitle}» появился в карточке помещения.`
          : request.body.status === "rejected"
            ? `Rooms отклонил отзыв. Причина: ${comment}`
            : `Отзыв о «${review.roomTitle}» снова ожидает проверки Rooms.`,
        dedupeKey: `review-moderated|${review.id}|${request.body.status}|${review.updatedAt}`,
      });
    });
    return review;
  });

  app.get<{ Querystring: AdminModerationQuerystring }>("/v1/admin/moderation", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["pending", "approved", "rejected", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request.headers.authorization);
    return config.partnerCatalogRepository.listModeration({
      status: request.query.status ?? "all",
      limit: request.query.limit ?? 80,
    });
  });

  const moderationParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["moderationId"],
    properties: { moderationId: { type: "string", minLength: 36, maxLength: 36 } },
  } as const;
  const moderationDecisionBodySchema = {
    type: "object",
    additionalProperties: false,
    properties: { comment: { type: "string", maxLength: 1000 } },
  } as const;

  app.post<{ Params: AdminModerationParams; Body: AdminModerationDecisionBody }>("/v1/admin/moderation/:moderationId/approve", {
    schema: { params: moderationParamsSchema, body: moderationDecisionBodySchema },
  }, async (request) => {
    const admin = await requireAdmin(request.headers.authorization);
    const item = await config.partnerCatalogRepository.decideModeration(
      request.params.moderationId,
      admin.id,
      "approved",
      request.body?.comment?.trim() ?? "",
    );
    if (!item) throw new ApiError(404, "MODERATION_NOT_FOUND", "Изменение для модерации не найдено.");
    return item;
  });

  app.post<{ Params: AdminModerationParams; Body: AdminModerationDecisionBody }>("/v1/admin/moderation/:moderationId/reject", {
    schema: { params: moderationParamsSchema, body: moderationDecisionBodySchema },
  }, async (request) => {
    const admin = await requireAdmin(request.headers.authorization);
    const comment = request.body?.comment?.trim() ?? "";
    if (comment.length < 3) throw new ApiError(400, "REVIEW_COMMENT_REQUIRED", "Укажите причину отклонения для партнёра.");
    const item = await config.partnerCatalogRepository.decideModeration(
      request.params.moderationId,
      admin.id,
      "rejected",
      comment,
    );
    if (!item) throw new ApiError(404, "MODERATION_NOT_FOUND", "Изменение для модерации не найдено.");
    return item;
  });

  app.get("/v1/partner/moderation", async (request) => {
    const { venueId } = await requirePartnerVenue(request.headers.authorization);
    return config.partnerCatalogRepository.listModeration({ status: "all", limit: 30, venueId });
  });

  app.get("/v1/partner/venue", async (request) => {
    const { venueId } = await requirePartnerVenue(request.headers.authorization);
    const venue = await config.partnerCatalogRepository.getVenue(venueId);
    if (!venue) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Для этого кабинета площадка ещё не назначена.");
    return venue;
  });

  app.patch<{ Body: PartnerVenueWrite }>("/v1/partner/venue", {
    schema: { body: partnerVenueWriteSchema },
  }, async (request, reply) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    const venue = await config.partnerCatalogRepository.updateVenue(venueId, actorId, validatePartnerVenueWrite(request.body));
    if (!venue) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Площадка кабинета не найдена.");
    return reply.code(202).send(venue);
  });

  app.get("/v1/partner/rooms", async (request) => {
    const { venueId } = await requirePartnerVenue(request.headers.authorization);
    return config.partnerCatalogRepository.listRooms(venueId);
  });

  app.post("/v1/partner/venue/photos", async (request, reply) => uploadPartnerPhoto(request, reply, null));

  app.post<{ Params: PartnerRoomParams }>("/v1/partner/rooms/:roomId/photos", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["roomId"],
        properties: { roomId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request, reply) => uploadPartnerPhoto(request, reply, request.params.roomId));

  app.patch<{ Body: PartnerPhotoOrderBody }>("/v1/partner/photos/order", {
    schema: { body: partnerPhotoOrderBodySchema },
  }, async (request, reply) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    const photos = await config.partnerCatalogRepository.reorderPhotos(venueId, actorId, request.body.photoIds);
    if (!photos) throw new ApiError(404, "PARTNER_PHOTO_NOT_FOUND", "Фотография не найдена в кабинете этой площадки.");
    return reply.code(202).send({ status: "review", photos });
  });

  app.delete<{ Params: PartnerPhotoParams }>("/v1/partner/photos/:photoId", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["photoId"],
        properties: { photoId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request, reply) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    const removed = await config.partnerCatalogRepository.removePhoto(venueId, request.params.photoId, actorId);
    if (!removed) throw new ApiError(404, "PARTNER_PHOTO_NOT_FOUND", "Фотография не найдена в кабинете этой площадки.");
    return reply.code(202).send({ status: "review", photoId: request.params.photoId });
  });

  app.post<{ Body: PartnerRoomWrite }>("/v1/partner/rooms", {
    schema: { body: partnerRoomWriteSchema },
  }, async (request, reply) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    const room = await config.partnerCatalogRepository.createRoom(venueId, actorId, validatePartnerRoomWrite(request.body));
    return reply.code(202).send(room);
  });

  app.patch<{ Params: PartnerRoomParams; Body: PartnerRoomWrite }>("/v1/partner/rooms/:roomId", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["roomId"],
        properties: { roomId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: partnerRoomWriteSchema,
    },
  }, async (request) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    const room = await config.partnerCatalogRepository.updateRoom(
      venueId,
      request.params.roomId,
      actorId,
      validatePartnerRoomWrite(request.body),
    );
    if (!room) throw new ApiError(404, "PARTNER_ROOM_NOT_FOUND", "Помещение не найдено в кабинете этой площадки.");
    return room;
  });

  app.put<{ Params: PartnerScheduleDateParams; Body: PartnerScheduleExceptionWrite }>("/v1/partner/schedule-exceptions/:date", {
    schema: { params: partnerScheduleDateParamsSchema, body: partnerScheduleExceptionWriteSchema },
  }, async (request) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    if (!isIsoDate(request.params.date)) throw new ApiError(400, "INVALID_DATE", "Проверьте дату особого графика.");
    if (request.body.mode === "custom" && (
      request.body.opensAtHour === null
      || request.body.closesAtHour === null
      || request.body.closesAtHour <= request.body.opensAtHour
    )) {
      throw new ApiError(400, "INVALID_SCHEDULE_EXCEPTION", "Для особых часов закрытие должно быть позже открытия.");
    }
    const venue = await config.partnerCatalogRepository.setScheduleException(
      venueId,
      actorId,
      request.params.date,
      request.body,
    );
    if (!venue) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Площадка кабинета не найдена.");
    return venue;
  });

  app.delete<{ Params: PartnerScheduleDateParams }>("/v1/partner/schedule-exceptions/:date", {
    schema: { params: partnerScheduleDateParamsSchema },
  }, async (request) => {
    const { actorId, venueId } = await requirePartnerVenue(request.headers.authorization);
    if (!isIsoDate(request.params.date)) throw new ApiError(400, "INVALID_DATE", "Проверьте дату особого графика.");
    const venue = await config.partnerCatalogRepository.deleteScheduleException(venueId, actorId, request.params.date);
    if (!venue) throw new ApiError(404, "PARTNER_VENUE_NOT_FOUND", "Площадка кабинета не найдена.");
    return venue;
  });

  app.get<{ Querystring: PartnerReservationQuery }>("/v1/partner/reservations", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          roomId: { type: "string", minLength: 36, maxLength: 36 },
          dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          dateTo: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          includeCancelled: { type: "boolean" },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    if (request.query.dateFrom && !isIsoDate(request.query.dateFrom)) throw new ApiError(400, "INVALID_DATE", "Проверьте начальную дату календаря.");
    if (request.query.dateTo && !isIsoDate(request.query.dateTo)) throw new ApiError(400, "INVALID_DATE", "Проверьте конечную дату календаря.");
    if (request.query.dateFrom && request.query.dateTo && request.query.dateFrom > request.query.dateTo) {
      throw new ApiError(400, "INVALID_DATE_RANGE", "Начальная дата не может быть позже конечной.");
    }
    return config.reservationRepository.listByPartner(current.user.id, request.query);
  });

  app.post<{ Body: PartnerReservationBody }>("/v1/partner/reservations", {
    schema: { body: partnerReservationBodySchema },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const input = await validatePartnerReservation(current.user.id, request.body);
    return reply.code(201).send(await config.reservationRepository.create(current.user.id, input));
  });

  app.patch<{ Params: ReservationParams; Body: PartnerReservationBody }>("/v1/partner/reservations/:reservationId", {
    schema: { params: reservationParamsSchema, body: partnerReservationBodySchema },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const input = await validatePartnerReservation(current.user.id, request.body);
    const reservation = await config.reservationRepository.update(current.user.id, request.params.reservationId, input);
    if (!reservation) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Запись календаря не найдена.");
    return reservation;
  });

  app.post<{ Params: ReservationParams; Body: ReservationCancelBody }>("/v1/partner/reservations/:reservationId/cancel", {
    schema: {
      params: reservationParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: { reason: { type: "string", minLength: 3, maxLength: 1000 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const reservation = await config.reservationRepository.cancel(current.user.id, request.params.reservationId, request.body.reason.trim());
    if (!reservation) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Запись календаря не найдена.");
    return reservation;
  });

  app.post<{ Params: ReservationParams }>("/v1/partner/reservations/:reservationId/restore", {
    schema: { params: reservationParamsSchema },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const existing = await config.reservationRepository.findByPartner(current.user.id, request.params.reservationId);
    if (!existing) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Запись календаря не найдена.");
    await validatePartnerReservation(current.user.id, {
      roomId: existing.roomId,
      type: existing.type,
      ...(existing.category ? { category: existing.category } : {}),
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      clientName: existing.clientName,
      clientPhone: existing.clientPhone,
      guests: existing.guests,
      amount: existing.amount,
      source: existing.source,
      comment: existing.comment,
    });
    const reservation = await config.reservationRepository.restore(current.user.id, request.params.reservationId);
    if (!reservation) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Запись календаря не найдена.");
    return reservation;
  });

  app.delete<{ Params: ReservationParams }>("/v1/partner/reservations/:reservationId", {
    schema: { params: reservationParamsSchema },
  }, async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const deleted = await config.reservationRepository.deleteTechnical(current.user.id, request.params.reservationId);
    if (!deleted) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Запись календаря не найдена.");
    return reply.code(204).send();
  });

  app.get<{ Querystring: PartnerBookingQuery }>("/v1/partner/bookings", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          statusGroup: { type: "string", enum: ["new", "payment", "booked", "history", "all"] },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    return config.bookingRepository.listByPartner(current.user.id, request.query.statusGroup ?? "all");
  });

  app.get<{ Querystring: SupportQuerystring }>("/v1/partner/support", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["open", "working", "closed", "all"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 80 },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    return config.supportRepository.list(current.user.id, "partner", request.query.status ?? "all", request.query.limit ?? 80);
  });

  app.get("/v1/partner/reviews", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    return config.reviewRepository.listByPartner(current.user.id);
  });

  app.patch<{ Params: ReviewParams; Body: ReviewReplyBody }>("/v1/partner/reviews/:reviewId/reply", {
    schema: {
      params: reviewParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["body"],
        properties: { body: { type: "string", minLength: 3, maxLength: 1000 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const review = await config.reviewRepository.reply(current.user.id, request.params.reviewId, request.body.body.trim());
    if (!review) throw new ApiError(404, "REVIEW_NOT_FOUND", "Отзыв не найден в кабинете этой площадки.");
    await queueNotification("review_partner_replied", () => notifications.enqueueBookingClient(review.bookingId, {
      eventKey: "review_partner_replied",
      title: `${review.venueTitle} ответил на отзыв`,
      body: `Площадка ответила на ваш отзыв о «${review.roomTitle}».`,
      dedupeKey: `review-reply|${review.id}|${review.updatedAt}`,
    }));
    return review;
  });

  app.post<{ Params: BookingParams }>("/v1/partner/bookings/:bookingId/complete", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const booking = await config.bookingRepository.completeByPartner(current.user.id, request.params.bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в очереди этой площадки.");
    await queueNotification("booking_completed_by_partner", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingClient(booking.id, {
        eventKey: "booking_completed_by_partner",
        title: `Посещение ${booking.publicNumber} завершено`,
        body: `Теперь можно оставить отзыв о «${booking.rooms.find((room) => room.isPrimary)?.title ?? booking.rooms[0]?.title ?? "помещении"}».`,
        dedupeKey: `booking-completed-partner|${booking.id}`,
      });
    });
    return booking;
  });

  app.post<{ Params: BookingParams; Body: PartnerBookingProposalBody }>("/v1/partner/bookings/:bookingId/proposal", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["startsAt", "durationMinutes"],
        properties: {
          startsAt: { type: "string", minLength: 20, maxLength: 40 },
          durationMinutes: { type: "integer", minimum: 30, maximum: 1440, multipleOf: 30 },
          comment: { type: "string", maxLength: 1000 },
        },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const input = await validateBookingProposal(current.user.id, request.params.bookingId, request.body);
    const booking = await config.bookingRepository.proposeTimeByPartner(current.user.id, request.params.bookingId, input);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в очереди этой площадки.");
    await queueNotification("booking_time_proposed", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingClient(booking.id, {
        eventKey: "booking_time_proposed",
        title: `${booking.venue.title} предложил другое время`,
        body: `По заявке ${booking.publicNumber} доступно другое окно. Откройте заявку, чтобы принять или отклонить предложение.`,
        dedupeKey: `proposal-created|${booking.proposal?.id ?? booking.id}`,
      });
    });
    return booking;
  });

  app.post<{ Params: BookingParams }>("/v1/partner/bookings/:bookingId/confirm", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const booking = await config.bookingRepository.confirmByPartner(current.user.id, request.params.bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в очереди этой площадки.");
    await queueNotification("booking_confirmed", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingClient(booking.id, {
        eventKey: "booking_confirmed",
        title: `${booking.venue.title} подтвердил заявку`,
        body: `Время по заявке ${booking.publicNumber} подтверждено. Внесите предоплату в личном кабинете, чтобы закрепить бронь.`,
        dedupeKey: `booking-confirmed|${booking.id}`,
      });
    });
    return booking;
  });

  app.post<{ Params: BookingParams; Body: PartnerBookingRejectBody }>("/v1/partner/bookings/:bookingId/reject", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: { bookingId: { type: "string", minLength: 36, maxLength: 36 } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: { reason: { type: "string", minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    if (!current || current.user.role !== "partner") throw new ApiError(401, "UNAUTHORIZED", "Войдите в кабинет партнёра.");
    const booking = await config.bookingRepository.rejectByPartner(current.user.id, request.params.bookingId, request.body.reason.trim());
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND", "Заявка не найдена в очереди этой площадки.");
    await queueNotification("booking_rejected", async () => {
      await notifications.rememberBookingRecipients(booking.id, booking.clientId, booking.venue.id);
      await notifications.enqueueBookingClient(booking.id, {
        eventKey: "booking_rejected",
        title: `Заявка ${booking.publicNumber} не подтверждена`,
        body: `${booking.venue.title} не смог подтвердить выбранное время. Причина: ${request.body.reason.trim()}`,
        dedupeKey: `booking-rejected|${booking.id}`,
      });
    });
    return booking;
  });

  app.get<{ Params: CityParams }>("/v1/cities/:cityId/stats", {
    schema: {
      params: {
        type: "object",
        required: ["cityId"],
        properties: { cityId: { type: "string", minLength: 1, maxLength: 100 } },
      },
    },
  }, async (request) => {
    const stats = await config.repository.getCityStats(request.params.cityId);
    if (!stats) throw new ApiError(404, "CITY_NOT_FOUND", "Город не найден или ещё не поддерживается Rooms.");
    return stats;
  });

  app.get<{ Querystring: SearchQuery }>("/v1/rooms", {
    schema: {
      querystring: {
        type: "object",
        required: ["city"],
        additionalProperties: false,
        properties: {
          city: { type: "string", minLength: 1, maxLength: 100 },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
          durationMinutes: { type: "integer", minimum: 30, maximum: 1440, multipleOf: 30 },
          guests: { type: "integer", minimum: 1, maximum: 1000 },
          type: { type: "string", maxLength: 50 },
          features: { type: "string", maxLength: 500 },
          maxPricePerHour: { type: "number", minimum: 0 },
          sort: { type: "string", enum: ["rating", "price", "capacity"] },
        },
      },
    },
  }, async (request) => {
    const filters = normalizeFilters(request.query);
    const foundRooms = await config.repository.searchRooms(filters);
    const rooms = filters.date ? await withReservationBlocks(foundRooms, filters.date) : foundRooms;
    const availableRooms = filters.date
      ? rooms.filter((room) => {
          const windows = availabilityForRoom(room, filters.date!, filters.durationMinutes, filters.time);
          return filters.time ? windows.some((window) => window.exactMatch) : windows.length > 0;
        })
      : rooms;
    const items = await Promise.all(availableRooms.map((room) => presentRoom(
      config.repository,
      room,
      config.publicSiteUrl,
      config.publicApiUrl,
      filters.date,
      filters.durationMinutes,
      filters.time,
    )));
    return { items, nextCursor: null, hasMore: false };
  });

  app.get<{ Params: RoomParams }>("/v1/rooms/:roomId/reviews", {
    schema: {
      params: {
        type: "object",
        required: ["roomId"],
        properties: { roomId: { type: "string", minLength: 1, maxLength: 100 } },
      },
    },
  }, async (request): Promise<PublicReviewPage> => {
    const reviews = await config.reviewRepository.listPublicRoom(request.params.roomId);
    if (!reviews) throw new ApiError(404, "ROOM_NOT_FOUND", "Помещение не найдено.");
    return { items: reviews, nextCursor: null, hasMore: false };
  });

  app.get<{ Params: RoomParams; Querystring: RoomQuery }>("/v1/rooms/:roomId", {
    schema: {
      params: {
        type: "object",
        required: ["roomId"],
        properties: { roomId: { type: "string", minLength: 1, maxLength: 100 } },
      },
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
      },
    },
  }, async (request): Promise<PublicRoomDetail> => {
    const date = request.query.date ?? moscowToday();
    if (!isIsoDate(date)) throw new ApiError(400, "INVALID_DATE", "Дата должна существовать и иметь формат YYYY-MM-DD.");
    const foundRoom = await config.repository.findRoom(request.params.roomId, date);
    if (!foundRoom) throw new ApiError(404, "ROOM_NOT_FOUND", "Помещение не найдено.");
    const room = (await withReservationBlocks([foundRoom], date))[0]!;
    const summary = await presentRoom(config.repository, room, config.publicSiteUrl, config.publicApiUrl, date);
    return {
      ...summary,
      description: room.description,
      rules: room.rules,
      opensAtHour: room.opensAtHour,
      closesAtHour: room.closesAtHour,
      bufferMinutes: room.bufferMinutes,
      services: room.services,
      priceRules: room.priceRules ?? [],
      availability: {
        date,
        timezone: MOSCOW_TIMEZONE,
        windows: availabilityForRoom(room, date, room.minimumHours * 60, undefined, 30, room.bufferMinutes, room.bufferMinutes),
      },
    };
  });

  app.post<{ Body: AvailabilityBody }>("/v1/availability/search", {
    schema: {
      body: {
        type: "object",
        required: ["roomIds", "date", "durationMinutes"],
        additionalProperties: false,
        properties: {
          roomIds: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          durationMinutes: { type: "integer", minimum: 30, maximum: 1440, multipleOf: 30 },
          preferredTime: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
          guests: { type: "integer", minimum: 1, maximum: 1000 },
        },
      },
    },
  }, async (request) => {
    const body = request.body;
    if (!isIsoDate(body.date)) throw new ApiError(400, "INVALID_DATE", "Дата должна существовать и иметь формат YYYY-MM-DD.");
    const found = await Promise.all(body.roomIds.map((id) => config.repository.findRoom(id, body.date)));
    const missing = body.roomIds.filter((_, index) => !found[index]);
    if (missing.length) throw new ApiError(404, "ROOM_NOT_FOUND", "Одно или несколько помещений не найдены.", missing);
    const rooms = await withReservationBlocks(found.filter((room): room is Room => room !== null), body.date);
    const capacityFits = !body.guests || rooms.every((room) => room.capacityMax >= body.guests!);
    const windows: AvailabilityWindow[] = capacityFits
      ? intersectAvailability(
          rooms.map((room) => availabilityForRoom(room, body.date, body.durationMinutes, body.preferredTime, 30, room.bufferMinutes, room.bufferMinutes)),
          body.durationMinutes,
          body.preferredTime,
        )
      : [];
    return { date: body.date, timezone: MOSCOW_TIMEZONE, windows };
  });

  app.post<{ Body: PlanningPreviewBody }>("/v1/planning/preview", {
    schema: {
      body: {
        type: "object",
        required: ["roomSets", "date", "preferredTime", "durationMinutes", "guests"],
        additionalProperties: false,
        properties: {
          roomSets: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              required: ["id", "roomIds"],
              additionalProperties: false,
              properties: {
                id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" },
                roomIds: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
              },
            },
          },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          preferredTime: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
          durationMinutes: { type: "integer", minimum: 30, maximum: 720, multipleOf: 15 },
          guests: { type: "integer", minimum: 1, maximum: 1000 },
          maxTotalPriceRub: { type: "number", minimum: 0, maximum: 100000000 },
          maxVariants: { type: "integer", minimum: 1, maximum: 20 },
          maxVariantsPerRoomSet: { type: "integer", minimum: 1, maximum: 10 },
          requiredFeatures: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
          requestedServiceIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
  }, async (request, reply) => {
    if (await planningIpAttempts.blocked(request.ip)) {
      reply.header("Retry-After", "60");
      throw new ApiError(429, "PLANNING_RATE_LIMITED", "Слишком много расчётов. Повторите через минуту.");
    }
    await planningIpAttempts.fail(request.ip);
    if (!isIsoDate(request.body.date)) throw new ApiError(400, "INVALID_DATE", "Дата должна существовать и иметь формат YYYY-MM-DD.");
    const setIds = request.body.roomSets.map((roomSet) => roomSet.id);
    if (new Set(setIds).size !== setIds.length) throw new ApiError(400, "DUPLICATE_ROOM_SET", "Идентификаторы наборов помещений не должны повторяться.");
    const uniqueRoomIds = [...new Set(request.body.roomSets.flatMap((roomSet) => roomSet.roomIds))];
    if (uniqueRoomIds.length > 20) throw new ApiError(400, "TOO_MANY_ROOMS", "За один расчёт можно проверить не более 20 помещений.");
    const found = await Promise.all(uniqueRoomIds.map((id) => config.repository.findRoom(id, request.body.date)));
    const missing = uniqueRoomIds.filter((_, index) => !found[index]);
    if (missing.length) throw new ApiError(404, "ROOM_NOT_FOUND", "Одно или несколько помещений не найдены.", missing);
    const hydrated = await withReservationBlocks(found.filter((room): room is Room => room !== null), request.body.date);
    const roomsById = new Map(hydrated.map((room) => [room.id, room]));
    try {
      const result = planBooking({
        date: request.body.date,
        preferredTime: request.body.preferredTime,
        durationMinutes: request.body.durationMinutes,
        guests: request.body.guests,
        requiredFeatures: request.body.requiredFeatures ?? [],
        requestedServiceIds: request.body.requestedServiceIds ?? [],
        roomSets: request.body.roomSets.map((roomSet) => ({
          id: roomSet.id,
          rooms: roomSet.roomIds.map((id) => roomsById.get(id)!),
          stepMinutesByRoomId: Object.fromEntries(roomSet.roomIds.map((id) => [id, 30])),
          bookingBufferByRoomId: Object.fromEntries(roomSet.roomIds.map((id) => {
            const buffer = roomsById.get(id)?.bufferMinutes ?? 0;
            return [id, { beforeMinutes: buffer, afterMinutes: buffer }];
          })),
        })),
        ...(request.body.maxTotalPriceRub !== undefined ? { maxTotalPriceRub: request.body.maxTotalPriceRub } : {}),
        ...(request.body.maxVariants !== undefined ? { maxVariants: request.body.maxVariants } : {}),
        ...(request.body.maxVariantsPerRoomSet !== undefined ? { maxVariantsPerRoomSet: request.body.maxVariantsPerRoomSet } : {}),
      });
      return reply.header("Cache-Control", "no-store").send({
        ...result,
        date: request.body.date,
        timezone: MOSCOW_TIMEZONE,
      });
    } catch (error) {
      throw new ApiError(400, "PLANNING_INPUT_INVALID", error instanceof Error ? error.message : "Некорректные условия расчёта.");
    }
  });

  return app;
}
