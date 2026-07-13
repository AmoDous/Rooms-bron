import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { availabilityForRoom } from "../src/availability.js";
import { MemoryCatalogRepository, roomIds } from "../src/catalog.js";
import type { Room } from "../src/types.js";

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

test("local preview serves the current site and its room photography", async () => {
  const page = await app.inject({ method: "GET", url: "/" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"] ?? "", /text\/html/);
  assert.match(page.body, /Rooms/);
  const photo = await app.inject({ method: "GET", url: "/assets/kids-loft.jpg" });
  assert.equal(photo.statusCode, 200);
  assert.match(photo.headers["content-type"] ?? "", /image\/jpeg/);
  assert.ok(photo.rawPayload.length > 1000);
});

test("cities include pilot Voronezh and Moscow", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/cities" });
  assert.equal(response.statusCode, 200);
  const cities = response.json();
  assert.equal(cities.find((city: { name: string }) => city.name === "Воронеж")?.pilot, true);
  assert.ok(cities.some((city: { name: string }) => city.name === "Москва"));
});

test("client auth keeps passwords private and revokes a logged-out session", async () => {
  const registration = {
    name: "Тестовый клиент",
    email: "client.auth@rooms.test",
    phone: "+7 900 111-22-33",
    city: "Воронеж",
    password: "rooms-test-2026",
    legal: {
      termsVersion: "test-1",
      privacyVersion: "test-1",
      acceptedAt: new Date().toISOString(),
    },
  };
  const created = await app.inject({ method: "POST", url: "/v1/auth/client/register", payload: registration });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().user.email, registration.email);
  assert.equal(created.json().user.phone, "+79001112233");
  assert.equal("password" in created.json().user, false);
  assert.equal("passwordHash" in created.json().user, false);
  assert.match(String(created.headers["set-cookie"]), /rooms_refresh=.*HttpOnly/);

  const duplicate = await app.inject({ method: "POST", url: "/v1/auth/client/register", payload: registration });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, "ACCOUNT_EXISTS");

  const wrong = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { login: registration.email, password: "wrong-password" },
  });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().code, "INVALID_CREDENTIALS");

  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { login: "+7 900 111-22-33", password: registration.password },
  });
  assert.equal(login.statusCode, 200);
  const accessToken = login.json().accessToken;
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  assert.ok(accessToken);

  const me = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().name, registration.name);

  const refresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { cookie } });
  assert.equal(refresh.statusCode, 200);
  const refreshedAccessToken = refresh.json().accessToken;
  const refreshedCookie = String(refresh.headers["set-cookie"]).split(";")[0];
  assert.ok(refreshedAccessToken);
  assert.notEqual(refreshedCookie, cookie);
  const supersededAccess = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(supersededAccess.statusCode, 401);
  const replayedRefresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { cookie } });
  assert.equal(replayedRefresh.statusCode, 401);

  const logout = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { authorization: `Bearer ${refreshedAccessToken}`, cookie: refreshedCookie },
  });
  assert.equal(logout.statusCode, 204);
  assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);

  const revoked = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${refreshedAccessToken}` } });
  assert.equal(revoked.statusCode, 401);
  const expiredRefresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { cookie: refreshedCookie } });
  assert.equal(expiredRefresh.statusCode, 401);
  const malformedRefresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { cookie: "rooms_refresh=%E0%A4%A" } });
  assert.equal(malformedRefresh.statusCode, 401);
});

test("city stats expose exact supply and bucket the public audience", async () => {
  const launching = await app.inject({ method: "GET", url: "/v1/cities/воронеж/stats" });
  assert.equal(launching.statusCode, 200);
  assert.equal(launching.json().publishedVenues, 3);
  assert.equal(launching.json().publishedRooms, 5);
  assert.equal(launching.json().activeClientsLabel, null);
  assert.equal(launching.json().audienceStage, "launching");

  const audienceApp = buildApp({ logger: false, repository: new MemoryCatalogRepository({ Воронеж: 137 }) });
  const established = await audienceApp.inject({ method: "GET", url: "/v1/cities/воронеж/stats" });
  assert.equal(established.statusCode, 200);
  assert.equal(established.json().activeClientsLabel, "100+");
  assert.equal(established.json().audienceStage, "established");
  await audienceApp.close();
});

test("city stats reject unsupported cities", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/cities/unknown-city/stats" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "CITY_NOT_FOUND");
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

test("room reviews expose approved public feedback without client contacts", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/rooms/kosmos/reviews" });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].authorName, "Марина");
  assert.equal(payload.items[0].rating, 5);
  assert.equal(payload.hasMore, false);
  assert.equal("phone" in payload.items[0], false);
  assert.equal("email" in payload.items[0], false);
  assert.equal("clientId" in payload.items[0], false);
});

test("room reviews keep unknown rooms indistinguishable from private supply", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/rooms/unknown-room/reviews" });
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

test("availability rolls after-midnight windows into the next calendar day", () => {
  const nightRoom: Room = {
    id: roomIds.voiceVip,
    slug: "night-room",
    venueId: "10000000-0000-4000-8000-000000000002",
    title: "Ночная комната",
    subtitle: "",
    type: "lounge",
    capacityMin: 1,
    capacityMax: 12,
    pricePerHour: 2600,
    minimumHours: 1,
    rating: 4.8,
    reviewCount: 1,
    description: "",
    rules: "",
    promotion: null,
    features: [],
    tags: [],
    photoPaths: [],
    services: [],
    opensAtHour: 22,
    closesAtHour: 26,
    bufferMinutes: 0,
    defaultBlocked: [],
    blockedByDate: {},
    publicationStatus: "published",
  };
  const windows = availabilityForRoom(nightRoom, "2026-07-18", 60, "01:00");
  const preferred = windows.find((window) => window.exactMatch);
  assert.equal(preferred?.startsAt, "2026-07-19T01:00:00+03:00");
  assert.ok(windows.every((window) => !window.startsAt.includes("T24:") && !window.startsAt.includes("T25:")));
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
