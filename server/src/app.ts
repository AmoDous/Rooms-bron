import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { MemoryCatalogRepository, type CatalogRepository } from "./catalog.js";
import { availabilityForRoom, intersectAvailability, isIsoDate, MOSCOW_TIMEZONE, moscowToday } from "./availability.js";
import type {
  AvailabilityWindow,
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
    corsOrigins: overrides.corsOrigins ?? ["http://localhost:3000", "http://127.0.0.1:3000", "https://amodous.github.io"],
    logger: overrides.logger ?? false,
    repository: overrides.repository ?? new MemoryCatalogRepository(),
  };
  const app = Fastify({ logger: config.logger });

  void app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ ...errorPayload(error.code, error.message, error.details), requestId: request.id });
    }
    if ("validation" in error && error.validation) {
      return reply.status(400).send({
        ...errorPayload("VALIDATION_ERROR", "Проверьте параметры запроса.", error.validation),
        requestId: request.id,
      });
    }
    request.log.error(error);
    return reply.status(500).send({ ...errorPayload("INTERNAL_ERROR", "Не удалось обработать запрос."), requestId: request.id });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ ...errorPayload("ROUTE_NOT_FOUND", "Маршрут API не найден."), requestId: request.id });
  });

  app.get("/health", async () => ({
    status: "ok",
    database: config.repository.storage === "postgresql" ? "up" : "down",
    storage: config.repository.storage,
    time: new Date().toISOString(),
  }));

  app.get("/v1/cities", async () => config.repository.listCities());

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
    const room = await config.repository.findRoom(request.params.roomId);
    if (!room) throw new ApiError(404, "ROOM_NOT_FOUND", "Помещение не найдено.");
    const date = request.query.date ?? moscowToday();
    if (!isIsoDate(date)) throw new ApiError(400, "INVALID_DATE", "Дата должна существовать и иметь формат YYYY-MM-DD.");
    const summary = await presentRoom(config.repository, room, config.publicSiteUrl, date);
    return {
      ...summary,
      description: room.description,
      rules: room.rules,
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
    const found = await Promise.all(body.roomIds.map((id) => config.repository.findRoom(id)));
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
