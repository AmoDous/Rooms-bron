import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { roomIds } from "../src/catalog.js";

let app: FastifyInstance;

before(async () => {
  app = buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
});

test("health reports the active repository", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().status, "ok");
  assert.deepEqual(response.json().storage, "memory");
  assert.deepEqual(response.json().database, "down");
});

test("cities include pilot Voronezh and Moscow", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/cities" });
  assert.equal(response.statusCode, 200);
  const cities = response.json();
  assert.equal(cities.find((city: { name: string }) => city.name === "Воронеж")?.pilot, true);
  assert.ok(cities.some((city: { name: string }) => city.name === "Москва"));
});

test("room search requires a city", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/rooms" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "VALIDATION_ERROR");
  assert.ok(response.json().requestId);
});

test("room search keeps cities isolated and sorts by rating", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж" });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.items.length, 5);
  assert.ok(payload.items.every((room: { venue: { city: string } }) => room.venue.city === "Воронеж"));
  assert.equal(payload.items[0].slug, "kosmos");
  assert.equal(payload.hasMore, false);
});

test("room search applies capacity, type, feature and price filters", async () => {
  const capacity = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж&guests=20" });
  assert.deepEqual(capacity.json().items.map((room: { slug: string }) => room.slug), ["terrace-hall"]);

  const type = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж&type=karaoke" });
  assert.deepEqual(type.json().items.map((room: { slug: string }) => room.slug), ["voice-small"]);

  const features = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж&features=parking,food" });
  assert.deepEqual(features.json().items.map((room: { slug: string }) => room.slug), ["kosmos", "terrace-hall"]);

  const price = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж&maxPricePerHour=1500" });
  assert.deepEqual(price.json().items.map((room: { slug: string }) => room.slug), ["safari"]);
});

test("time search rejects missing and impossible dates", async () => {
  const missingDate = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж&time=12:00" });
  assert.equal(missingDate.statusCode, 400);
  assert.equal(missingDate.json().code, "DATE_REQUIRED");

  const impossibleDate = await app.inject({ method: "GET", url: "/v1/rooms?city=Воронеж&date=2026-02-30" });
  assert.equal(impossibleDate.statusCode, 400);
  assert.equal(impossibleDate.json().code, "INVALID_DATE");
});

test("time search excludes busy rooms and puts the requested start first", async () => {
  const busy = await app.inject({
    method: "GET",
    url: "/v1/rooms?city=Воронеж&type=kids&date=2026-07-18&time=18:00&durationMinutes=120",
  });
  assert.equal(busy.statusCode, 200);
  assert.deepEqual(busy.json().items, []);

  const free = await app.inject({
    method: "GET",
    url: "/v1/rooms?city=Воронеж&type=kids&date=2026-07-18&time=20:00&durationMinutes=120",
  });
  assert.equal(free.statusCode, 200);
  assert.deepEqual(free.json().items.map((room: { slug: string }) => room.slug), ["kosmos", "safari"]);
  assert.ok(free.json().items.every((room: { nearestWindows: Array<{ startsAt: string; exactMatch: boolean }> }) => (
    room.nearestWindows[0]?.startsAt.includes("T20:00:00") && room.nearestWindows[0]?.exactMatch
  )));
});

test("room detail accepts a legacy slug and exposes services and windows", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/rooms/kosmos?date=2026-07-18" });
  assert.equal(response.statusCode, 200);
  const room = response.json();
  assert.equal(room.id, roomIds.kosmos);
  assert.equal(room.venue.slug, "kids-loft");
  assert.equal(room.services.length, 2);
  assert.ok(room.availability.windows.length > 0);
  assert.ok(room.photos.every((photo: string) => photo.startsWith("https://amodous.github.io/Rooms-bron/assets/")));
});

test("room detail returns a stable not-found error", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/rooms/unknown-room" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "ROOM_NOT_FOUND");
});

test("availability intersects several rooms and explains the maximum duration", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/availability/search",
    payload: {
      roomIds: [roomIds.kosmos, roomIds.safari],
      date: "2026-07-18",
      durationMinutes: 120,
      preferredTime: "20:00",
      guests: 8,
    },
  });
  assert.equal(response.statusCode, 200);
  const windows = response.json().windows;
  assert.ok(windows.some((window: { startsAt: string; exactMatch: boolean }) => window.startsAt.includes("T20:00:00") && window.exactMatch));
  assert.ok(windows.some((window: { startsAt: string }) => window.startsAt.includes("T15:00:00")));
  assert.ok(!windows.some((window: { startsAt: string }) => window.startsAt.includes("T18:00:00")));
  assert.equal(windows.find((window: { startsAt: string }) => window.startsAt.includes("T20:00:00"))?.maximumDurationMinutes, 120);
});

test("availability rejects unknown rooms and over-capacity groups", async () => {
  const unknown = await app.inject({
    method: "POST",
    url: "/v1/availability/search",
    payload: { roomIds: ["unknown-room"], date: "2026-07-18", durationMinutes: 120 },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().code, "ROOM_NOT_FOUND");

  const capacity = await app.inject({
    method: "POST",
    url: "/v1/availability/search",
    payload: { roomIds: [roomIds.kosmos, roomIds.safari], date: "2026-07-18", durationMinutes: 120, guests: 15 },
  });
  assert.equal(capacity.statusCode, 200);
  assert.deepEqual(capacity.json().windows, []);
});

test("CORS allows the published Rooms origin", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/v1/rooms?city=Воронеж",
    headers: {
      origin: "https://amodous.github.io",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://amodous.github.io");
});
