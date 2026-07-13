import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthConflictError, AuthService, MemoryAuthRepository, normalizeRussianPhone, type AuthRepository, type IssuedAuthSession } from "./auth.js";
import { MemoryCatalogRepository, type CatalogRepository } from "./catalog.js";
import { availabilityForRoom, intersectAvailability, isIsoDate, MOSCOW_TIMEZONE, moscowToday } from "./availability.js";
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
  corsOrigins: string[];
  logger: boolean;
  repository: CatalogRepository;
  authRepository: AuthRepository;
  authTokenSecret: string;
  secureCookies: boolean;
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

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetContentTypes: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

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

class AuthAttemptLimiter {
  private readonly entries = new Map<string, { failures: number; resetAt: number }>();

  blocked(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return entry.failures >= 5;
  }

  fail(key: string): void {
    const current = this.entries.get(key);
    this.entries.set(key, current && current.resetAt > Date.now()
      ? { ...current, failures: current.failures + 1 }
      : { failures: 1, resetAt: Date.now() + 10 * 60 * 1000 });
  }

  clear(key: string): void {
    this.entries.delete(key);
  }
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

function photoUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), base).toString();
}

async function presentRoom(
  repository: CatalogRepository,
  room: Room,
  publicSiteUrl: string,
  date?: string,
  durationMinutes = room.minimumHours * 60,
  preferredTime?: string,
): Promise<PublicRoomSummary> {
  const venue = await repository.findVenue(room.venueId);
  if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Площадка помещения не найдена.");
  const nearestWindows = date
    ? (() => {
        const windows = availabilityForRoom(room, date, durationMinutes, preferredTime);
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
    photos: room.photoPaths.map((path) => photoUrl(publicSiteUrl, path)),
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
  const config: AppConfig = {
    publicSiteUrl: overrides.publicSiteUrl ?? "https://amodous.github.io/Rooms-bron",
    corsOrigins: overrides.corsOrigins ?? ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:4173", "http://127.0.0.1:4173", "https://amodous.github.io"],
    logger: overrides.logger ?? false,
    repository: overrides.repository ?? new MemoryCatalogRepository(),
    authRepository: overrides.authRepository ?? new MemoryAuthRepository(),
    authTokenSecret: overrides.authTokenSecret ?? "rooms-local-development-secret-change-me-2026",
    secureCookies: overrides.secureCookies ?? false,
  };
  const app = Fastify({ logger: config.logger });
  const auth = new AuthService(config.authRepository, config.authTokenSecret);
  const authAttempts = new AuthAttemptLimiter();

  void app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    credentials: true,
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ ...errorPayload(error.code, error.message, error.details), requestId: request.id });
    }
    if (error instanceof AuthConflictError) {
      return reply.status(409).send({ ...errorPayload("ACCOUNT_EXISTS", "Кабинет с такой почтой или телефоном уже существует."), requestId: request.id });
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

  app.get("/", async (_request, reply) => {
    const html = await readFile(resolve(projectRoot, "index.html"));
    return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
  });

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

  app.get("/health", async () => ({
    status: "ok",
    database: config.repository.storage === "postgresql" ? "up" : "down",
    storage: config.repository.storage,
    time: new Date().toISOString(),
  }));

  app.get("/v1/cities", async () => config.repository.listCities());

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
    const attemptKey = `${request.ip}|${login.toLocaleLowerCase("ru-RU")}`;
    if (authAttempts.blocked(attemptKey)) throw new ApiError(429, "LOGIN_RATE_LIMITED", "Слишком много попыток. Повторите вход через 10 минут.");
    const session = await auth.login(login, request.body.password, request.ip, request.headers["user-agent"] ?? null);
    if (!session) {
      authAttempts.fail(attemptKey);
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверная почта, телефон или пароль.");
    }
    authAttempts.clear(attemptKey);
    refreshCookie(reply, session.refreshToken, session.refreshExpiresIn, config.secureCookies);
    return authResponse(session);
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    const token = cookieValue(request.headers.cookie, "rooms_refresh");
    const session = token ? await auth.refresh(token, request.ip, request.headers["user-agent"] ?? null) : null;
    if (!session) {
      clearRefreshCookie(reply, config.secureCookies);
      throw new ApiError(401, "SESSION_EXPIRED", "Сессия завершена. Войдите снова.");
    }
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
    const rooms = await config.repository.searchRooms(filters);
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
    const reviews = await config.repository.listRoomReviews(request.params.roomId);
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
    const room = await config.repository.findRoom(request.params.roomId, date);
    if (!room) throw new ApiError(404, "ROOM_NOT_FOUND", "Помещение не найдено.");
    const summary = await presentRoom(config.repository, room, config.publicSiteUrl, date);
    return {
      ...summary,
      description: room.description,
      rules: room.rules,
      opensAtHour: room.opensAtHour,
      closesAtHour: room.closesAtHour,
      bufferMinutes: room.bufferMinutes,
      services: room.services,
      availability: {
        date,
        timezone: MOSCOW_TIMEZONE,
        windows: availabilityForRoom(room, date, room.minimumHours * 60),
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
    const rooms = found.filter((room): room is Room => room !== null);
    const capacityFits = !body.guests || rooms.every((room) => room.capacityMax >= body.guests!);
    const windows: AvailabilityWindow[] = capacityFits
      ? intersectAvailability(
          rooms.map((room) => availabilityForRoom(room, body.date, body.durationMinutes, body.preferredTime)),
          body.durationMinutes,
          body.preferredTime,
        )
      : [];
    return { date: body.date, timezone: MOSCOW_TIMEZONE, windows };
  });

  return app;
}
