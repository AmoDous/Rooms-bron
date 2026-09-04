import assert from "node:assert/strict";
import test from "node:test";
import { planBooking, roomPriceForBooking, ROOMS_PLANNER_VERSION } from "../src/planning.js";
import type { HourInterval, Room, RoomPriceRule, RoomService } from "../src/types.js";

function room(id: string, options: { price?: number; capacity?: number; blocked?: HourInterval[]; minimumHours?: number; features?: string[]; services?: RoomService[]; priceRules?: RoomPriceRule[] } = {}): Room {
  return {
    id,
    slug: id,
    venueId: "venue-1",
    title: id,
    subtitle: "test",
    type: "test",
    capacityMin: 1,
    capacityMax: options.capacity ?? 10,
    pricePerHour: options.price ?? 1000,
    minimumHours: options.minimumHours ?? 2,
    rating: 0,
    reviewCount: 0,
    description: "test",
    rules: "test",
    promotion: null,
    features: options.features ?? [],
    tags: [],
    photoPaths: [],
    services: options.services ?? [],
    priceRules: options.priceRules ?? [],
    opensAtHour: 10,
    closesAtHour: 20,
    bufferMinutes: 0,
    defaultBlocked: options.blocked ?? [],
    blockedByDate: {},
    publicationStatus: "published",
  };
}

test("planner returns deterministic ranked variants with auditable components", () => {
  const request = {
    date: "2026-09-15",
    preferredTime: "12:00",
    durationMinutes: 120,
    guests: 8,
    roomSets: [{ id: "main", rooms: [room("r1")] }],
    maxVariants: 3,
  } as const;
  const first = planBooking(request);
  const second = planBooking(request);
  assert.equal(first.algorithmVersion, ROOMS_PLANNER_VERSION);
  assert.equal(first.constraintSetHash, second.constraintSetHash);
  assert.deepEqual(first.variants, second.variants);
  assert.equal(first.variants.length, 3);
  assert.equal(first.variants[0]?.startsAt.slice(11, 16), "12:00");
  assert.equal(first.variants[0]?.exactStart, true);
  assert.equal(Object.keys(first.variants[0]?.components ?? {}).length, 4);
  assert.ok(first.variants[0]?.reasons.some((reason) => reason.code === "EXACT_START"));
});

test("fragmentation weight can preserve a bookable long interval", () => {
  const result = planBooking({
    date: "2026-09-15",
    preferredTime: "10:00",
    durationMinutes: 120,
    guests: 5,
    roomSets: [{ id: "split", rooms: [room("r1", { blocked: [[13, 15]] })] }],
    weights: { timeShift: 0.2, fragmentation: 0.8, price: 0, capacitySlack: 0 },
  });
  assert.equal(result.exactCandidateAvailable, true);
  assert.notEqual(result.variants[0]?.startsAt.slice(11, 16), "10:00");
  assert.equal(result.variants[0]?.components.fragmentation.raw, 0);
  assert.ok(result.variants.some((variant) => variant.exactStart && variant.components.fragmentation.raw === 60));
});

test("planner compares room sets by price and capacity while enforcing hard limits", () => {
  const result = planBooking({
    date: "2026-09-15",
    preferredTime: "12:00",
    durationMinutes: 120,
    guests: 8,
    maxTotalPriceRub: 3000,
    roomSets: [
      { id: "small", rooms: [room("small", { capacity: 6, price: 500 })] },
      { id: "fit", rooms: [room("fit", { capacity: 8, price: 1000 })] },
      { id: "expensive", rooms: [room("expensive", { capacity: 20, price: 2000 })] },
    ],
  });
  assert.deepEqual(result.rejections, [
    { roomSetId: "small", codes: ["CAPACITY"] },
    { roomSetId: "expensive", codes: ["PRICE_LIMIT"] },
  ]);
  assert.equal(result.variants[0]?.roomSetId, "fit");
  assert.equal(result.variants[0]?.totalPriceRub, 2000);
  assert.ok(result.variants[0]?.reasons.some((reason) => reason.code === "CAPACITY_MATCH"));
});

test("planner can return only the best start for every room set", () => {
  const result = planBooking({
    date: "2026-09-15",
    preferredTime: "12:00",
    durationMinutes: 120,
    guests: 4,
    roomSets: [
      { id: "budget", rooms: [room("budget", { price: 500 })] },
      { id: "premium", rooms: [room("premium", { price: 1500 })] },
    ],
    maxVariants: 10,
    maxVariantsPerRoomSet: 1,
  });
  assert.deepEqual(result.variants.map((variant) => variant.roomSetId).sort(), ["budget", "premium"]);
  assert.ok(result.variants.every((variant) => variant.startsAt.slice(11, 16) === "12:00"));
});

test("planner supports a common window for several rooms and different start steps", () => {
  const result = planBooking({
    date: "2026-09-15",
    preferredTime: "12:15",
    durationMinutes: 120,
    guests: 12,
    roomSets: [{
      id: "combined",
      rooms: [room("a", { capacity: 6 }), room("b", { capacity: 8, blocked: [[10, 12.5]] })],
      stepMinutesByRoomId: { a: 15, b: 30 },
      bookingBufferByRoomId: { a: { beforeMinutes: 15, afterMinutes: 15 }, b: { beforeMinutes: 0, afterMinutes: 30 } },
    }],
  });
  assert.equal(result.variants[0]?.startsAt.slice(11, 16), "12:30");
  assert.deepEqual(result.variants[0]?.roomIds, ["a", "b"]);
});

test("dynamic tariffs split the room price across tariff boundaries", () => {
  const pricedRoom = room("dynamic", {
    price: 1000,
    priceRules: [{
      id: "evening", label: "Вечер", weekdays: [2], startsAtHour: 18, endsAtHour: 22,
      pricePerHour: 2000, priority: 0, active: true,
    }],
  });
  assert.equal(roomPriceForBooking(pricedRoom, "2026-09-15", "2026-09-15T17:00:00+03:00", 120), 3000);
});

test("planner enforces features and services and includes them in the total", () => {
  const service = { id: "photo", name: "Фотограф", description: null, price: 2500 };
  const result = planBooking({
    date: "2026-09-15",
    preferredTime: "12:00",
    durationMinutes: 120,
    guests: 5,
    requiredFeatures: ["projector"],
    requestedServiceIds: [service.id],
    roomSets: [
      { id: "suitable", rooms: [room("suitable", { features: ["projector"], services: [service] })] },
      { id: "missing-feature", rooms: [room("missing-feature", { services: [service] })] },
      { id: "missing-service", rooms: [room("missing-service", { features: ["projector"] })] },
    ],
  });
  assert.equal(result.variants[0]?.totalPriceRub, 4500);
  assert.equal(result.variants[0]?.roomPriceRub, 2000);
  assert.equal(result.variants[0]?.servicesPriceRub, 2500);
  assert.ok(result.variants[0]?.reasons.some((reason) => reason.code === "SERVICES_INCLUDED"));
  assert.deepEqual(result.rejections, [
    { roomSetId: "missing-feature", codes: ["REQUIRED_FEATURES"] },
    { roomSetId: "missing-service", codes: ["SERVICE_UNAVAILABLE"] },
  ]);
});
